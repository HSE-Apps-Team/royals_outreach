"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import SaveButton from "@/app/components/saveButton";
import IconButton from "@/app/components/iconButton";
import Select from "@/app/components/select";
import Switch from "@/app/components/switch";
import { CheckInPrompt } from "./WalkInDialog";
import { useDialogFocus } from "./dialogFocus";
import "@/app/css/eventAttendance.css";
import {
  FACING_MODE_CHOICES,
  listCameras,
  startBarcodeCamera,
  type BarcodeCamera,
  type CameraChoice,
  type CameraOption,
} from "@/lib/barcodeCamera";
import { eventLongDate, eventTimeName, eventTimeOption, markedTime } from "@/lib/eventFormat";
import { formatTime } from "@/lib/formatTime";
import { fullName } from "@/lib/personName";
import { schoolClockOf } from "@/lib/schoolDate";
import { normalizeId } from "@/lib/scannerIds";
import { playBeep, unlockAudio } from "@/lib/scanSound";
import {
  lookupCheckIn,
  type AttendanceStatus,
  type ClubEventTime,
  type MarkAttendanceResult,
  type RosterStudent,
} from "@/actions/events";

// A card held in front of the camera gets read many times per second.
// Ignore repeat reads of the same ID inside this window.
const SAME_CARD_COOLDOWN_MS = 3000;

// Two matching Code 39 reads must land within this window to count.
const CODE_39_CONFIRM_WINDOW_MS = 2500;

const RECENT_COUNT = 8;

type Tone = "success" | "late" | "warning" | "info" | "danger";

type StatusMessage = { tone: Tone; icon: string; text: string; shownAt: number };

type RecentScan = { key: number; name: string; status: string; tone: Tone; icon: string; sub: string };

type AttendanceScannerProps = {
  clubId: number;
  clubName: string;
  event: { eventId: number; name: string; date: string; times: ClubEventTime[] };
  /** Everyone on the roster, for "checked in / total". */
  total: number;
  checkedIn: number;
  late: number;
  walkIns: number;
  timeId: number | null;
  onTimeChange: (timeId: number) => void;
  /** The same setting as Mark New Check Ins As Late on the page. */
  lateMode: boolean;
  onLateModeChange: (late: boolean) => void;
  /** Marks a student and updates the page's roster. */
  onMark: (student: RosterStudent, status: AttendanceStatus, method: "Scanned", isWalkIn: boolean) => Promise<MarkAttendanceResult>;
  /** Opens the walk in popup; resolves true when the exec chooses Add As Walk In. */
  onAskWalkIn: (student: RosterStudent) => Promise<boolean>;
  /** A popup from the page is open on top of the scanner. */
  covered: boolean;
  onClose: () => void;
};

function describeCameraError(error: unknown) {
  const err = error as { name?: string; message?: string } | null;
  const errorText = String(err?.name || err?.message || error);
  if (!window.isSecureContext) {
    return "The camera only works over HTTPS. Open this page with https://.";
  }
  if (errorText.includes("NotAllowed") || errorText.includes("Permission")) {
    return "Camera permission was denied. Allow camera access in your browser settings, then press Start Camera again.";
  }
  if (errorText.includes("NotFound") || errorText.includes("Overconstrained")) {
    return "That camera was not found. Try picking a different camera.";
  }
  if (errorText.includes("NotReadable")) {
    return "The camera is being used by another app or tab. Close it and try again.";
  }
  return `Could not start the camera: ${errorText}`;
}

export default function AttendanceScanner({
  clubId,
  clubName,
  event,
  total,
  checkedIn,
  late,
  walkIns,
  timeId,
  onTimeChange,
  lateMode,
  onLateModeChange,
  onMark,
  onAskWalkIn,
  covered,
  onClose,
}: AttendanceScannerProps) {
  const [cameraChoice, setCameraChoice] = useState<CameraChoice>("environment");
  const [detectedCameras, setDetectedCameras] = useState<CameraOption[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [flash, setFlash] = useState<{ tone: Tone; shownAt: number } | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [isSecure, setIsSecure] = useState(true);

  const cameraRef = useRef<BarcodeCamera | null>(null); // controls returned by startBarcodeCamera
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastScanRef = useRef({ id: "", time: 0 });
  const pendingCode39Ref = useRef({ id: "", time: 0 });
  // A scan waiting on the server or on a popup. Decoding stays paused until it is done.
  const busyRef = useRef(false);
  const recentKeyRef = useRef(0);
  const titleId = useId();

  const multi = event.times.length > 1;
  const timeIndex = Math.max(0, event.times.findIndex((t) => t.timeId === timeId));
  const sessionName = multi
    ? eventTimeOption(event.times, timeIndex)
    : event.times[0]
      ? `${formatTime(event.times[0].startTime)} · ${event.times[0].location}`
      : "";
  const popupOpen = covered || notFoundId !== null;

  useDialogFocus(panelRef, { active: !popupOpen, onEscape: onClose });

  // window is only read after mount, so the first render matches the server
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSecure(window.isSecureContext);
  }, []);

  const showStatus = (tone: Tone, icon: string, text: string) => {
    setStatusMessage({ tone, icon, text, shownAt: Date.now() });
  };

  const showFlash = (tone: Tone) => {
    setFlash({ tone, shownAt: Date.now() });
  };

  const addRecent = (scan: Omit<RecentScan, "key">) => {
    recentKeyRef.current++;
    setRecent((previous) => [{ ...scan, key: recentKeyRef.current }, ...previous].slice(0, RECENT_COUNT));
  };

  const nowLine = () => formatTime(schoolClockOf(new Date()));

  const resumeScanner = () => {
    busyRef.current = false;
    cameraRef.current?.setPaused(false);
  };

  // Code 39 has no built-in check digit, so a blurry frame can be misread.
  // Only accept a Code 39 read once two frames agree.
  const isConfirmedCode39Read = (scannedId: string, now: number) => {
    const pending = pendingCode39Ref.current;
    if (pending.id === scannedId && now - pending.time < CODE_39_CONFIRM_WINDOW_MS) {
      pendingCode39Ref.current = { id: "", time: 0 };
      return true;
    }
    pendingCode39Ref.current = { id: scannedId, time: now };
    return false;
  };

  const markScanned = async (student: RosterStudent, isWalkIn: boolean) => {
    const status: AttendanceStatus = lateMode ? "Late" : "Present";
    const name = fullName(student);
    const result = await onMark(student, status, "Scanned", isWalkIn);

    if (!result.success) {
      showStatus("danger", "x-circle-fill", result.error);
      showFlash("danger");
      playBeep(330, 0.25);
      return;
    }
    const at = markedTime(result.attendance);
    const which = multi ? ` · ${eventTimeName(event.times, result.attendance.timeId)}` : "";
    if (result.alreadyCheckedIn) {
      showStatus("warning", "exclamation-triangle-fill", `Already checked in: ${name} (${result.attendance.status})`);
      showFlash("warning");
      playBeep(330, 0.25);
      addRecent({ name, status: "Already In", tone: "warning", icon: "exclamation-triangle-fill", sub: at });
      return;
    }

    const saved = result.attendance.status;
    const tone: Tone = saved === "Late" ? "late" : "success";
    showStatus(
      tone,
      isWalkIn ? "person-plus-fill" : "check-circle-fill",
      `${isWalkIn ? "Walk in added" : "Checked in"}: ${name} · ${saved}`,
    );
    showFlash(tone);
    playBeep(880, 0.15);
    addRecent({
      name,
      status: isWalkIn ? "Walk In" : saved,
      tone,
      icon: isWalkIn ? "person-plus-fill" : "check-circle-fill",
      sub: `${at}${which}`,
    });
  };

  // Called by the camera every time it reads a barcode.
  const handleScan = async (rawText: string, isCode39: boolean) => {
    const scannedId = normalizeId(rawText);
    if (scannedId === "" || busyRef.current || popupOpen) return;

    const now = Date.now();
    const lastScan = lastScanRef.current;
    if (lastScan.id === scannedId && now - lastScan.time < SAME_CARD_COOLDOWN_MS) return;
    if (isCode39 && !isConfirmedCode39Read(scannedId, now)) return;
    lastScanRef.current = { id: scannedId, time: now };

    // Pause decoding while the server looks the card up, so reads do not pile up
    busyRef.current = true;
    cameraRef.current?.setPaused(true);
    let waitsForPopup = false;

    try {
      const lookup = await lookupCheckIn(clubId, event.eventId, { scannedId });

      if (!lookup.success) {
        showStatus("danger", "x-circle-fill", lookup.error);
        showFlash("danger");
        playBeep(330, 0.25);
      } else if (lookup.kind === "notMember") {
        // Not a club member: show the popup. Decoding stays paused until OK.
        waitsForPopup = true;
        setNotFoundId(lookup.scannedId);
        showStatus("danger", "x-circle-fill", `ID ${lookup.scannedId} is not a club member.`);
        showFlash("danger");
        playBeep(600, 0.1);
        addRecent({ name: `ID ${lookup.scannedId}`, status: "Not Found", tone: "danger", icon: "x-circle-fill", sub: nowLine() });
      } else if (lookup.kind === "student") {
        const student = lookup.student;
        const current = student.attendance;

        if (current && (current.status === "Present" || current.status === "Late")) {
          showStatus("warning", "exclamation-triangle-fill", `Already checked in: ${fullName(student)} (${current.status})`);
          showFlash("warning");
          playBeep(330, 0.25);
          addRecent({
            name: fullName(student),
            status: "Already In",
            tone: "warning",
            icon: "exclamation-triangle-fill",
            sub: markedTime(current),
          });
        } else if (!student.isAssigned && !current?.isWalkIn) {
          // A club member outside the event's groups: pause and ask first. The video keeps running.
          waitsForPopup = true;
          showFlash("warning");
          playBeep(600, 0.1);
          const add = await onAskWalkIn(student);
          if (add) {
            await markScanned(student, true);
          } else {
            showStatus("info", "info-circle", "Scan discarded.");
          }
          lastScanRef.current = { id: scannedId, time: Date.now() };
          resumeScanner();
        } else {
          await markScanned(student, !student.isAssigned);
        }
      }
    } catch {
      showStatus("danger", "x-circle-fill", "Could not check this card. Please try again.");
      showFlash("danger");
    } finally {
      if (!waitsForPopup) resumeScanner();
    }
  };

  // The camera callback is registered once, so point it at the latest handler.
  const handleScanRef = useRef(handleScan);
  useEffect(() => {
    handleScanRef.current = handleScan;
  });

  // Keep decoding paused while any popup is open over the scanner.
  useEffect(() => {
    if (!busyRef.current) cameraRef.current?.setPaused(popupOpen);
  }, [popupOpen]);

  const closeNotFound = () => {
    lastScanRef.current = { id: notFoundId ?? "", time: Date.now() };
    setNotFoundId(null);
    resumeScanner();
  };

  const stopScanner = () => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    setIsScanning(false);
  };

  const startScanner = async (choice: CameraChoice = cameraChoice) => {
    unlockAudio(); // must happen during a tap for iPad Safari
    setIsStarting(true);
    setStatusMessage(null);
    stopScanner();

    try {
      cameraRef.current = await startBarcodeCamera({
        videoElement: videoRef.current!,
        cameraChoice: choice,
        onDecode: (text, isCode39) => handleScanRef.current(text, isCode39),
      });
      if (popupOpen || busyRef.current) cameraRef.current.setPaused(true);
      setIsScanning(true);
      showStatus("info", "camera-video-fill", "Camera on. Hold a student ID up to the camera.");
      // Camera names are only available after permission is granted.
      setDetectedCameras(await listCameras());
    } catch (error) {
      stopScanner();
      showStatus("danger", "x-circle-fill", describeCameraError(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleCameraChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const newChoice = e.target.value;
    setCameraChoice(newChoice);
    if (isScanning) startScanner(newChoice);
  };

  const handleLateChange = (value: boolean) => {
    onLateModeChange(value);
    showStatus(
      value ? "late" : "success",
      value ? "clock-history" : "check-circle",
      value ? "Future scans will be marked Late." : "Future scans will be marked Present.",
    );
  };

  // Turn the camera off when the popup closes or the page is left.
  useEffect(() => {
    return () => cameraRef.current?.stop();
  }, []);

  const cameraOptions = [
    ...FACING_MODE_CHOICES.map((camera) => ({ value: camera.value, label: camera.label })),
    ...detectedCameras.map((camera, cameraNumber) => ({
      value: camera.id,
      label: camera.label || `Camera ${cameraNumber + 1}`,
    })),
  ];

  return (
    <div className="attendance-scanner-scrim">
      <div
        ref={panelRef}
        className="attendance-scanner"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="attendance-scanner-head">
          <div className="attendance-scanner-head-text">
            <div className="attendance-scanner-eyebrow">ID Scanner</div>
            <h2 id={titleId} className="attendance-scanner-title">
              {event.name}
            </h2>
            <div className="attendance-scanner-sub">
              {eventLongDate(event.date)} · {sessionName}
            </div>
          </div>
          <IconButton icon="x-lg" label="Close Scanner" size={22} onClick={onClose} />
        </div>

        {/* Body */}
        <div className="attendance-scanner-body">
          <div className="attendance-scanner-main">
            {!isSecure && (
              <div className="attendance-scanner-status attendance-scanner-status-danger" role="alert">
                <i className="bi bi-shield-exclamation" aria-hidden="true" />
                The camera only works over HTTPS. Open this page with https://.
              </div>
            )}

            <div className="attendance-scanner-camera-row">
              <Select
                label="Camera"
                options={cameraOptions}
                value={cameraChoice}
                onChange={handleCameraChange}
                disabled={isStarting}
                className="attendance-scanner-camera-select"
              />
              {isScanning ? (
                <SaveButton variant="danger" icon="stop-fill" size="lg" onClick={stopScanner}>
                  Stop
                </SaveButton>
              ) : (
                <SaveButton icon="camera-video-fill" size="lg" onClick={() => startScanner()} disabled={isStarting}>
                  {isStarting ? "Starting..." : "Start Camera"}
                </SaveButton>
              )}
            </div>

            <div className="attendance-scanner-viewport">
              <video
                ref={videoRef}
                className={`attendance-scanner-video ${cameraChoice === "user" ? "attendance-scanner-video-mirrored" : ""}`.trim()}
                playsInline
                muted
                aria-label="Camera preview for scanning student ID barcodes"
              />
              {isScanning ? (
                <>
                  <div className="attendance-scanner-hint">
                    {popupOpen ? "Paused while you answer the popup" : "Scanning · Hold the barcode anywhere in view"}
                  </div>
                </>
              ) : (
                <div className="attendance-scanner-placeholder">
                  <i className="bi bi-upc-scan" aria-hidden="true" />
                  <span className="attendance-scanner-placeholder-title">Press Start Camera to scan student IDs</span>
                  <span>The camera only works over HTTPS. Your browser will ask for permission the first time.</span>
                </div>
              )}
              {flash && (
                <div
                  key={flash.shownAt}
                  className={`attendance-scanner-flash attendance-scanner-flash-${flash.tone}`}
                  aria-hidden="true"
                />
              )}
            </div>

            <div role="status" aria-live="polite" className="attendance-scanner-status-area">
              {statusMessage && (
                <div
                  key={statusMessage.shownAt}
                  className={`attendance-scanner-status attendance-scanner-status-${statusMessage.tone}`}
                >
                  <i className={`bi bi-${statusMessage.icon}`} aria-hidden="true" />
                  {statusMessage.text}
                </div>
              )}
            </div>
          </div>

          <div className="attendance-scanner-side">
            {multi && (
              <Select
                label="Event Time"
                options={event.times.map((t, i) => ({ value: String(t.timeId), label: eventTimeOption(event.times, i) }))}
                value={String(event.times[timeIndex].timeId)}
                onChange={(e) => onTimeChange(Number(e.target.value))}
              />
            )}

            <div className={`attendance-scanner-late ${lateMode ? "attendance-scanner-late-on" : ""}`.trim()}>
              <Switch label="Count Future Scans As Late" checked={lateMode} onChange={handleLateChange} />
              <p className="attendance-scanner-late-help">
                {lateMode
                  ? "On. Every new scan is marked Late. Students already checked in stay Present."
                  : "Turn this on once the event has started so anyone scanned after that is marked Late."}
              </p>
            </div>

            <div className="attendance-scanner-count">
              <div className="attendance-scanner-count-label">Checked In</div>
              <div className="attendance-scanner-count-value">
                {checkedIn} / {total}
              </div>
              <div className="attendance-scanner-count-sub">
                {late > 0 ? `${late} late` : "None late"}
                {walkIns > 0 && ` · ${walkIns} ${walkIns === 1 ? "walk in" : "walk ins"}`}
              </div>
            </div>

            <div>
              <h3 className="attendance-scanner-recent-head">Recent Scans</h3>
              {recent.length === 0 ? (
                <p className="attendance-scanner-recent-empty">No scans yet.</p>
              ) : (
                <ul className="attendance-scanner-recent">
                  {recent.map((scan) => (
                    <li key={scan.key} className="attendance-scanner-recent-row">
                      <i className={`bi bi-${scan.icon} attendance-tone-${scan.tone}`} aria-hidden="true" />
                      <div className="attendance-scanner-recent-text">
                        <div className="attendance-scanner-recent-name">{scan.name}</div>
                        <div className="attendance-scanner-recent-sub">{scan.sub}</div>
                      </div>
                      <span className={`attendance-scanner-recent-status attendance-tone-${scan.tone}`}>{scan.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="attendance-scanner-foot">
          Reads the Code 39 and Code 128 barcodes on HSE student IDs. The card can be tilted, sideways or upside down.
          If it will not read, move it a little closer or farther until the bars look sharp.
        </p>
      </div>

      {notFoundId !== null && (
        <NotFoundPrompt scannedId={notFoundId} clubName={clubName} onClose={closeNotFound} />
      )}
    </div>
  );
}

function NotFoundPrompt({ scannedId, clubName, onClose }: { scannedId: string; clubName: string; onClose: () => void }) {
  const titleId = useId();
  const bodyId = useId();

  return (
    <CheckInPrompt
      titleId={titleId}
      bodyId={bodyId}
      tone="danger"
      icon="person-x"
      title="No Club Member Found"
      who={`ID ${scannedId}`}
      onEscape={onClose}
      actions={(primaryRef) => (
        <button ref={primaryRef} type="button" className="save-button" onClick={onClose}>
          OK
        </button>
      )}
    >
      <p>
        This ID does not match anyone in {clubName || "this club"}. Only club members can be checked in. Check that the
        student joined the club in Royals Outreach.
      </p>
    </CheckInPrompt>
  );
}
