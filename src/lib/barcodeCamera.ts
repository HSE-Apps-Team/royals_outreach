// Camera and barcode decoding for the attendance scanner.
//
// Why this is set up by hand instead of using a ready-made scanner widget:
// - Each frame is decoded at the camera's full resolution. Shrinking the frame
//   to the on-screen box size blurs the thin bars of Code 39.
// - ZXing's "try harder" mode is on. It scans rows across the whole frame
//   (not just the middle), reads upside down, and retries with the image
//   turned 90 degrees, so the card does not have to be lined up exactly.
// - Every other frame is also turned a little before decoding, to catch
//   tilted cards (see TILT_CORRECTION_DEGREES).
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatOneDReader,
} from "@zxing/library";

// Wait this long between decode attempts so the page stays responsive.
const DELAY_BETWEEN_ATTEMPTS_MS = 60;

// Frames wider than this are scaled down first. Bigger frames decode slower
// without helping much at normal card distances.
const MAX_DECODE_WIDTH = 1920;

// ZXing reads along straight rows, so a short, wide barcode tilted more than
// about 10 degrees has no row that crosses every bar. Every other attempt we
// turn the frame by one of these angles first. ZXing also retries each frame
// turned 90 degrees, so together these cover the card at almost any angle.
const TILT_CORRECTION_DEGREES = [20, -20, 40, -40];

export type FacingMode = "environment" | "user";

/** A facing mode, or the deviceId of a camera picked by name. */
export type CameraChoice = FacingMode | string;

export type CameraOption = { id: string; label: string };

export type BarcodeCamera = {
  stop: () => void;
  setPaused: (shouldPause: boolean) => void;
};

export const FACING_MODE_CHOICES: { value: FacingMode; label: string }[] = [
  { value: "environment", label: "Back Camera" },
  { value: "user", label: "Front Camera" },
];

export function isFacingModeChoice(choice: CameraChoice): choice is FacingMode {
  return FACING_MODE_CHOICES.some((camera) => camera.value === choice);
}

const DECODE_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

// We use ZXing's 1D barcode reader directly instead of its MultiFormatReader.
// MultiFormatReader (version 0.23) prints a console warning on every frame
// that has no barcode, which floods the console and slows scanning.
const barcodeReader = new MultiFormatOneDReader(DECODE_HINTS);

// Returns the decoded result, or throws if there is no barcode in the canvas.
function decodeCanvas(canvas: HTMLCanvasElement) {
  const luminance = new HTMLCanvasElementLuminanceSource(canvas);
  const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
  return barcodeReader.decode(bitmap, DECODE_HINTS);
}

function buildCameraConstraints(choice: CameraChoice): MediaStreamConstraints {
  const whichCamera = isFacingModeChoice(choice)
    ? { facingMode: { ideal: choice } }
    : { deviceId: { exact: choice } };

  return {
    audio: false,
    video: {
      ...whichCamera,
      // Ask for HD. The browser gives the closest size the camera supports.
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
}

// focusMode is not in TypeScript's DOM types yet.
type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[] };

// Turn on continuous autofocus where the browser allows it (Chrome and Android).
// iPad Safari autofocuses on its own and ignores this, which is fine.
async function turnOnAutofocus(videoTrack: MediaStreamTrack) {
  try {
    const capabilities: FocusCapabilities = videoTrack.getCapabilities?.() || {};
    if (capabilities.focusMode?.includes("continuous")) {
      await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
    }
  } catch {
    // Not supported on this device.
  }
}

// List cameras by name. Names only show up after camera permission is granted.
export async function listCameras(): Promise<CameraOption[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device) => ({ id: device.deviceId, label: device.label }));
  } catch {
    return [];
  }
}

// Start the camera in the given <video> element and decode barcodes from it.
// onDecode(text, isCode39) is called for every successful read.
// Returns controls: stop() turns the camera off, setPaused(true/false) skips decoding.
export async function startBarcodeCamera({
  videoElement,
  cameraChoice,
  onDecode,
}: {
  videoElement: HTMLVideoElement;
  cameraChoice: CameraChoice;
  onDecode: (text: string, isCode39: boolean) => void;
}): Promise<BarcodeCamera> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera access.");
  }

  const stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints(cameraChoice));
  const [videoTrack] = stream.getVideoTracks();
  turnOnAutofocus(videoTrack);

  // iPad Safari needs these to play the video inline instead of full screen.
  videoElement.setAttribute("playsinline", "true");
  videoElement.muted = true;
  videoElement.srcObject = stream;
  try {
    await videoElement.play();
  } catch (error) {
    // Release the camera so its light doesn't stay on.
    stream.getTracks().forEach((track) => track.stop());
    videoElement.srcObject = null;
    throw error;
  }

  const canvas = document.createElement("canvas");
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true })!;

  let isStopped = false;
  let isPaused = false;
  let nextAttemptTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptNumber = 0;

  // Even attempts: frame as is (most cards are held level).
  // Odd attempts: cycle through the tilt angles.
  const pickRotationDegrees = () => {
    attemptNumber++;
    if (attemptNumber % 2 === 0) return 0;
    const tiltIndex = Math.floor(attemptNumber / 2) % TILT_CORRECTION_DEGREES.length;
    return TILT_CORRECTION_DEGREES[tiltIndex];
  };

  const drawFrame = (width: number, height: number, rotationDegrees: number) => {
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    if (rotationDegrees === 0) {
      canvasContext.drawImage(videoElement, 0, 0, width, height);
      return;
    }
    // Turn around the centre. The corners that fall outside are filled white.
    canvasContext.fillStyle = "white";
    canvasContext.fillRect(0, 0, width, height);
    canvasContext.translate(width / 2, height / 2);
    canvasContext.rotate((rotationDegrees * Math.PI) / 180);
    canvasContext.drawImage(videoElement, -width / 2, -height / 2, width, height);
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  };

  const decodeOneFrame = () => {
    if (isStopped) return;

    const frameWidth = videoElement.videoWidth;
    const frameHeight = videoElement.videoHeight;

    if (!isPaused && frameWidth > 0 && frameHeight > 0) {
      // Resize every frame in case the iPad was rotated.
      const scale = Math.min(1, MAX_DECODE_WIDTH / frameWidth);
      const decodeWidth = Math.round(frameWidth * scale);
      const decodeHeight = Math.round(frameHeight * scale);
      if (canvas.width !== decodeWidth || canvas.height !== decodeHeight) {
        canvas.width = decodeWidth;
        canvas.height = decodeHeight;
      }
      drawFrame(decodeWidth, decodeHeight, pickRotationDegrees());

      try {
        const result = decodeCanvas(canvas);
        onDecode(result.getText(), result.getBarcodeFormat() === BarcodeFormat.CODE_39);
      } catch {
        // No barcode in this frame. This happens most of the time.
      }
    }

    nextAttemptTimer = setTimeout(decodeOneFrame, DELAY_BETWEEN_ATTEMPTS_MS);
  };

  decodeOneFrame();

  return {
    stop() {
      isStopped = true;
      clearTimeout(nextAttemptTimer);
      stream.getTracks().forEach((track) => track.stop());
      videoElement.srcObject = null;
    },
    setPaused(shouldPause: boolean) {
      isPaused = shouldPause;
    },
  };
}
