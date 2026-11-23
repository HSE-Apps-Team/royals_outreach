"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import ClubSectionHeader from "@/app/components/clubSectionHeader";
import SaveButton from "@/app/components/saveButton";
import Tabs from "@/app/components/tabs";
import FilterBar from "@/app/components/filterBar";
import Input from "@/app/components/input";
import Pager from "@/app/components/pager";
import ModalShell from "@/app/components/ModalShell";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import EditHoursDialog from "@/app/components/EditHoursDialog";
import StudentSummaryPanel, { type StudentSummaryRequest } from "@/app/components/StudentSummaryPanel";
import AddHoursDialog from "./addHoursDialog";
import RequestTableRow, { type RowFlag } from "./requestTableRow";
import lionHead from "@/app/assets/lionHead.png";
import "@/app/css/club.css";
import { useToast } from "@/app/context/ToastContext";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";
import { fullName } from "@/lib/personName";

import type { ClubCategory } from "@/actions/categories";
import type { ClubMember } from "@/actions/members";
import {
  approveClubRequest,
  approveClubRequests,
  deleteClubRequest,
  denyClubRequest,
  denyClubRequests,
  restoreClubRequests,
  sendCoordinatorEmailsNow,
  updateClubRequest,
  type ClubRequest,
  type ClubRequestSnapshot,
} from "@/actions/clubRequests";

type HourRequestsUIProps = {
  clubId: number;
  clubName: string;
  requests: ClubRequest[];
  categories: ClubCategory[];
  /** Active members, the students hours can be added for. */
  members: ClubMember[];
  /** The school's date, so the forms match the server's check. */
  today: string;
};

type TabValue = "pending" | "email" | "approved" | "denied";

type Dialog =
  | { type: "add" }
  | { type: "bulkDeny" }
  | { type: "edit" | "delete" | "photo"; request: ClubRequest };
type EditResult = { saving: boolean; error: string };
type Group = "This Week" | "Last 30 Days" | "Older";

const ALL = "all";
const PER_PAGE = 10;
const UNDO_MS = 6000;
const WAITING_DAYS = 7;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_COLORS = [
  "var(--primaryBlue)",
  "var(--primaryRed)",
  "var(--secondaryGray)",
  "var(--warningAmber)",
  "var(--navy)",
];

const TABS: {
  value: TabValue;
  label: string;
  empty: [title: string, text: string];
  matches: (request: ClubRequest) => boolean;
}[] = [
  {
    value: "pending",
    label: "Pending",
    empty: ["You are all caught up!", "Nothing needs club approval right now. New requests will show up here."],
    matches: (r) => r.status === "Pending Club Verification",
  },
  {
    value: "email",
    label: "Awaiting Email",
    empty: ["No emails out", "No requests are waiting on a coordinator right now."],
    matches: (r) => r.status === "Pending Email Verification",
  },
  {
    value: "approved",
    label: "Approved",
    empty: ["No approved hours yet", "Approved requests will show up here."],
    matches: (r) => r.status === "Approved",
  },
  {
    value: "denied",
    label: "Denied",
    empty: ["Nothing denied", "Denied requests will show up here."],
    matches: (r) => r.status === "Denied",
  },
];

//--------------------------------------------------------------------------------------//
//                                       Helpers                                        //
//--------------------------------------------------------------------------------------//

const isPending = (r: ClubRequest) =>
  r.status === "Pending Club Verification" || r.status === "Pending Email Verification";

const studentName = (r: ClubRequest) => (r.student ? fullName(r.student) || "Unknown Student" : "Unknown Student");

// Days since 1970 for an ISO date, so two dates can be subtracted without time zones.
const dayNumber = (iso: string | null | undefined) => {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(iso ?? "");
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
};

const weekdayOf = (iso: string) => {
  const day = dayNumber(iso);
  return day === null ? "" : WEEKDAYS[new Date(day * 86_400_000).getUTCDay()];
};

const submittedLineOf = (r: ClubRequest) => {
  if (r.isManual) return "Added by club exec";
  const submitted = dayNumber(r.submittedOn);
  const event = dayNumber(r.isoDate);
  if (submitted === null || event === null) return null;

  const after = submitted - event;
  if (after <= 0) return "Submitted same day";
  return `Submitted ${plural(after, "day")} after`;
};

// Waiting counts from the submit date, or from the event date on rows logged before that was saved.
const waitingDaysOf = (r: ClubRequest, today: number | null) => {
  if (!isPending(r) || today === null) return null;
  const since = dayNumber(r.submittedOn) ?? dayNumber(r.isoDate);
  if (since === null) return null;
  const days = today - since;
  return days >= WAITING_DAYS ? days : null;
};

const groupOf = (r: ClubRequest, today: number | null): Group => {
  const day = dayNumber(r.isoDate);
  if (today === null || day === null) return "Older";
  const ago = today - day;
  return ago <= 7 ? "This Week" : ago <= 30 ? "Last 30 Days" : "Older";
};

const duplicateKey = (r: ClubRequest) => `${r.studentId}|${r.opportunity.trim().toLowerCase()}|${r.isoDate}`;

const snapshotOf = (r: ClubRequest): ClubRequestSnapshot => ({
  id: r.id,
  status: r.status,
  denyMessage: r.denyMessage ?? null,
  coordinatorName: r.coordinator ?? null,
  coordinatorEmail: r.coordinatorEmail ?? null,
});

//--------------------------------------------------------------------------------------//
//                                         Page                                         //
//--------------------------------------------------------------------------------------//

export default function HourRequestsUI({ clubId, clubName, requests, categories, members, today }: HourRequestsUIProps) {
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabValue>("pending");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [page, setPage] = useState(1);
  const [newestFirst, setNewestFirst] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [denying, setDenying] = useState<{ id: number; message: string } | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [studentRequestId, setStudentRequestId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editState, setEditState] = useState<EditResult>({ saving: false, error: "" });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);

  const todayNumber = dayNumber(today);
  const current = TABS.find((t) => t.value === tab) ?? TABS[0];
  const showStatusIcon = tab === "approved" || tab === "denied";
  const query = search.trim().toLowerCase();
  const filtering = query !== "" || category !== ALL;

  // Filter and sort
  const visible = requests
    .filter(
      (r) =>
        current.matches(r) &&
        (category === ALL || String(r.categoryId) === category) &&
        (!query || `${studentName(r)} ${r.opportunity}`.toLowerCase().includes(query)),
    )
    .sort((a, b) => {
      const byDate = (dayNumber(b.isoDate) ?? 0) - (dayNumber(a.isoDate) ?? 0) || b.id - a.id;
      return newestFirst ? byDate : -byDate;
    });

  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const groupCounts = new Map<Group, number>();
  visible.forEach((r) => {
    const g = groupOf(r, todayNumber);
    groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  });

  // Flags: same student, opportunity and date on two or more requests that are not denied
  const duplicateCounts = new Map<string, number>();
  requests.forEach((r) => {
    if (r.status === "Denied") return;
    const key = duplicateKey(r);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  });
  const flagsOf = (r: ClubRequest): RowFlag[] =>
    isPending(r) && (duplicateCounts.get(duplicateKey(r)) ?? 0) > 1
      ? [{ label: "Possible Duplicate", tip: "Another request has the same student, opportunity and date." }]
      : [];

  const categoryColor = (categoryId: number | null) => {
    const index = categories.findIndex((c) => c.categoryId === categoryId);
    return index < 0 ? "var(--secondaryGray)" : CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  };

  // Selection only ever holds pending requests that are still in the list
  const selectedRequests = requests.filter((r) => selectedIds.includes(r.id) && isPending(r) && current.matches(r));
  const selectablePageIds = pageRows.filter(isPending).map((r) => r.id);
  const pageAllSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIds.includes(id));

  const awaitingHours = requests.filter(isPending).reduce((sum, r) => sum + r.hours, 0);

  const sendEmailNow = async () => {
    setIsEmailing(true);
    const result = await sendCoordinatorEmailsNow(clubId);
    setIsEmailing(false);
    if (!result.success) {
      showToast(result.error, "danger");
      return;
    }
    showToast(`Sent ${plural(result.changed, "coordinator email")}.`);
  };

  // Resets that go with changing what the list shows
  const changeTab = (value: string) => {
    setTab(value as TabValue);
    setPage(1);
    setSelectedIds([]);
    setDenying(null);
  };
  const changePage = (n: number) => {
    setPage(n);
    setDenying(null);
  };

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const togglePage = () =>
    setSelectedIds((prev) =>
      pageAllSelected
        ? prev.filter((id) => !selectablePageIds.includes(id))
        : [...new Set([...prev, ...selectablePageIds])],
    );
  const unselect = (ids: number[]) => setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));

  //------------------------------------- Review --------------------------------------//

  const undo = async (snapshots: ClubRequestSnapshot[], reviewedStatus: "Approved" | "Denied") => {
    try {
      const result = await restoreClubRequests(clubId, snapshots, reviewedStatus);
      if (!result.success) showToast(result.error, "danger");
      else if (result.changed < snapshots.length)
        showToast(`Undid ${result.changed} of ${plural(snapshots.length, "review")}.`, "warning");
      else showToast("Review undone.", "success");
    } catch {
      showToast("Could not undo this review. Please try again.", "danger");
    }
  };

  const showReviewToast = (message: string, snapshots: ClubRequestSnapshot[], reviewedStatus: "Approved" | "Denied") =>
    showToast(message, "success", {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => undo(snapshots, reviewedStatus) },
    });

  // Runs one review at a time and reports failures as a toast.
  const review = async (run: () => Promise<void>, failure: string) => {
    if (isReviewing) return;
    setIsReviewing(true);
    try {
      await run();
    } catch {
      showToast(failure, "danger");
    } finally {
      setIsReviewing(false);
    }
  };

  const approve = (r: ClubRequest) =>
    review(async () => {
      const result = await approveClubRequest(clubId, r.id);
      unselect([r.id]);
      if (!result.success) return showToast(result.error, "danger");
      showReviewToast(`Approved ${formatHours(r.hours)} for ${studentName(r)}.`, [snapshotOf(r)], "Approved");
    }, "Could not save this review. Please try again.");

  const deny = (r: ClubRequest, message: string) =>
    review(async () => {
      const result = await denyClubRequest(clubId, r.id, message);
      if (!result.success) return showToast(result.error, "danger");
      setDenying(null);
      unselect([r.id]);
      showReviewToast(`Denied ${formatHours(r.hours)} for ${studentName(r)}.`, [snapshotOf(r)], "Denied");
    }, "Could not save this review. Please try again.");

  const approveSelected = () => {
    const chosen = selectedRequests;
    review(async () => {
      const result = await approveClubRequests(clubId, chosen.map((r) => r.id));
      unselect(chosen.map((r) => r.id));
      if (!result.success) return showToast(result.error, "danger");
      showReviewToast(`Approved ${plural(result.changed, "request")}.`, chosen.map(snapshotOf), "Approved");
    }, "Could not approve these requests. Please try again.");
  };

  const denySelected = () => {
    const chosen = selectedRequests;
    review(async () => {
      const result = await denyClubRequests(clubId, chosen.map((r) => r.id), bulkMessage);
      if (!result.success) return showToast(result.error, "danger");
      unselect(chosen.map((r) => r.id));
      setDialog(null);
      setDenying(null);
      showReviewToast(`Denied ${plural(result.changed, "request")}.`, chosen.map(snapshotOf), "Denied");
    }, "Could not deny these requests. Please try again.");
  };

  //------------------------------------ Edit/Delete ----------------------------------//

  const openEdit = (request: ClubRequest) => {
    setEditState({ saving: false, error: "" });
    setDenying(null);
    setDialog({ type: "edit", request });
  };

  const handleEdit = async (
    request: ClubRequest,
    edited: { hours: number; isoDate?: string; category?: string; status: ClubRequest["status"] },
  ) => {
    if (editState.saving) return;

    const categoryId = categories.find((c) => c.categoryName === edited.category)?.categoryId ?? null;
    setEditState({ saving: true, error: "" });
    try {
      const result = await updateClubRequest(clubId, request.id, {
        hours: edited.hours,
        isoDate: edited.isoDate ?? request.isoDate,
        categoryId,
        status: edited.status,
      });
      if (result.success) {
        setDialog(null);
        setEditState({ saving: false, error: "" });
        showToast("Request updated.", "success");
      } else {
        setEditState({ saving: false, error: result.error });
      }
    } catch {
      setEditState({ saving: false, error: "Could not save your changes. Please try again." });
    }
  };

  const handleDelete = async (request: ClubRequest) => {
    if (isDeleting) return;

    setIsDeleting(true);
    try {
      const result = await deleteClubRequest(clubId, request.id);
      if (result.success) showToast("Request deleted.", "success");
      else showToast(result.error, "danger");
      unselect([request.id]);
      setDialog(null);
    } catch {
      showToast("Could not delete this request. Please try again.", "danger");
    } finally {
      setIsDeleting(false);
    }
  };

  //---------------------------------- Student panel ----------------------------------//

  const studentRequest = requests.find((r) => r.id === studentRequestId);
  const studentRequests = studentRequest
    ? requests
        .filter((r) =>
          studentRequest.studentId !== null ? r.studentId === studentRequest.studentId : r.id === studentRequest.id,
        )
        .sort((a, b) => (dayNumber(b.isoDate) ?? 0) - (dayNumber(a.isoDate) ?? 0) || b.id - a.id)
    : [];
  const sumHours = (list: ClubRequest[]) => list.reduce((sum, r) => sum + r.hours, 0);
  const recent: StudentSummaryRequest[] = studentRequests.slice(0, 6).map((r) => ({
    id: r.id,
    opportunity: r.opportunity,
    date: r.date,
    status:
      r.status === "Pending Email Verification"
        ? "Awaiting Email"
        : r.status === "Pending Club Verification"
          ? "Pending"
          : r.status,
    tone: r.status === "Approved" ? "approved" : r.status === "Denied" ? "denied" : "pending",
    hours: r.hours,
  }));

  //-------------------------------------- Render -------------------------------------//

  const rows: ReactNode[] = [];
  let lastGroup: Group | null = null;
  pageRows.forEach((r) => {
    const group = groupOf(r, todayNumber);
    if (group !== lastGroup) {
      lastGroup = group;
      rows.push(
        <div key={`group-${group}`} className="club-requests-group" role="heading" aria-level={3}>
          <i className="bi bi-calendar3" aria-hidden="true" />
          {group}
          <span className="club-requests-group-count">· {plural(groupCounts.get(group) ?? 0, "request")}</span>
        </div>,
      );
    }
    rows.push(
      <RequestTableRow
        key={r.id}
        request={r}
        name={studentName(r)}
        categoryColor={categoryColor(r.categoryId)}
        showStatusIcon={showStatusIcon}
        weekday={weekdayOf(r.isoDate)}
        submittedLine={submittedLineOf(r)}
        waitingDays={waitingDaysOf(r, todayNumber)}
        flags={flagsOf(r)}
        selected={selectedIds.includes(r.id)}
        denying={denying?.id === r.id}
        denyMessage={denying?.id === r.id ? denying.message : ""}
        busy={isReviewing}
        onToggleSelect={() => toggleSelected(r.id)}
        onOpenStudent={() => setStudentRequestId(r.id)}
        onApprove={() => approve(r)}
        onStartDeny={() => setDenying(denying?.id === r.id ? null : { id: r.id, message: "" })}
        onDenyMessageChange={(message) => setDenying({ id: r.id, message })}
        onConfirmDeny={() => deny(r, denying?.id === r.id ? denying.message : "")}
        onCancelDeny={() => setDenying(null)}
        onEdit={() => openEdit(r)}
        onViewPhoto={() => setDialog({ type: "photo", request: r })}
      />,
    );
  });

  return (
    <div className="club-requests">
      {/* Header */}
      <ClubSectionHeader
        title="Hour Requests"
        subtitle="Review, approve and manage hours submitted to this club."
        clubName={clubName}
        actions={
          <>
            {/* TODO: testing only, remove before launch */}
            <SaveButton size="sm" variant="secondary" icon="envelope" disabled={isEmailing} onClick={sendEmailNow}>
              {isEmailing ? "Sending..." : "Send Email Now"}
            </SaveButton>
            <SaveButton size="sm" variant="secondary" icon="plus-circle" onClick={() => setDialog({ type: "add" })}>
              Add Hours Manually
            </SaveButton>
          </>
        }
      />

      {/* Tabs */}
      <div className="club-requests-tabs-row">
        <div className="club-requests-tabs">
          <Tabs
            ariaLabel="Filter Requests"
            tabs={TABS.map((t) => ({ value: t.value, label: t.label, count: requests.filter(t.matches).length }))}
            value={tab}
            onChange={changeTab}
          />
        </div>
        <div className="club-requests-awaiting">
          <span className="club-requests-awaiting-hours">{formatHours(awaitingHours)}</span> awaiting approval
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        searchPlaceholder="Search Students Or Opportunities"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        selects={
          categories.length > 0
            ? [
                {
                  name: "category",
                  value: category,
                  options: [
                    { value: ALL, label: "All Categories" },
                    ...categories.map((c) => ({ value: String(c.categoryId), label: c.categoryName })),
                  ],
                },
              ]
            : []
        }
        onSelectChange={(_, value) => {
          setCategory(value);
          setPage(1);
        }}
      />

      <div className="club-requests-list">
        {/* Bulk bar */}
        {selectedRequests.length > 0 && (
          <div className="club-requests-bulk" role="region" aria-label="Selected requests">
            <div className="club-requests-bulk-label">{plural(selectedRequests.length, "request")} selected</div>
            <button
              type="button"
              className="club-requests-btn club-requests-btn-bulk-approve"
              onClick={approveSelected}
              disabled={isReviewing}
            >
              <i className="bi bi-check-lg" aria-hidden="true" />
              Approve Selected
            </button>
            <button
              type="button"
              className="club-requests-btn club-requests-btn-bulk-deny"
              onClick={() => {
                setBulkMessage("");
                setDialog({ type: "bulkDeny" });
              }}
              disabled={isReviewing}
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
              Deny Selected
            </button>
            <button type="button" className="club-requests-btn club-requests-btn-bulk-clear" onClick={() => setSelectedIds([])}>
              Clear
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          /* Empty */
          <div className="club-requests-empty" role="status">
            <Image src={lionHead} alt="" width={120} className="club-requests-empty-lion" />
            <div className="club-requests-empty-title">{filtering ? "No matches" : current.empty[0]}</div>
            <div className="club-requests-empty-text">
              {filtering ? "No requests match your search or category. Try clearing the filters." : current.empty[1]}
            </div>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="club-requests-grid club-requests-head">
              <div className="club-requests-cell-check">
                {selectablePageIds.length > 0 && (
                  <input
                    type="checkbox"
                    className="club-requests-checkbox"
                    checked={pageAllSelected}
                    onChange={togglePage}
                    aria-label="Select all requests on this page"
                  />
                )}
              </div>
              <div className="club-requests-head-label">Student</div>
              <div className="club-requests-head-label">Opportunity</div>
              <div>
                <button
                  type="button"
                  className="club-requests-sort"
                  onClick={() => setNewestFirst((v) => !v)}
                  aria-label={`Sort by date, currently ${newestFirst ? "newest first" : "oldest first"}`}
                >
                  <i className={`bi bi-caret-${newestFirst ? "down" : "up"}-fill`} aria-hidden="true" />
                  Date · Hours
                </button>
              </div>
              <div className="club-requests-head-label">{showStatusIcon ? "Status · Coordinator" : "Coordinator"}</div>
              <div className="club-requests-head-count">{plural(visible.length, "Request")}</div>
            </div>

            {/* Rows */}
            {rows}

            <Pager
              page={currentPage}
              total={visible.length}
              perPage={PER_PAGE}
              onChange={changePage}
              ariaLabel="Hour request pages"
            />
          </>
        )}
      </div>

      {/* Student panel */}
      {studentRequest && (
        <StudentSummaryPanel
          student={studentRequest.student ?? { fName: "Unknown", lName: "Student" }}
          email={studentRequest.studentEmail}
          goal={categories.reduce((sum, c) => sum + (c.goal || 0), 0)}
          approvedHours={sumHours(studentRequests.filter((r) => r.status === "Approved"))}
          pendingHours={sumHours(studentRequests.filter(isPending))}
          deniedCount={studentRequests.filter((r) => r.status === "Denied").length}
          recent={recent}
          onClose={() => setStudentRequestId(null)}
        />
      )}

      {/* Dialogs */}
      {dialog?.type === "add" && (
        <AddHoursDialog
          clubId={clubId}
          categories={categories}
          members={members}
          today={today}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            changeTab("approved");
            setSearch("");
            setCategory(ALL);
            showToast("Hours added.", "success");
          }}
        />
      )}
      {dialog?.type === "edit" && (
        <EditHoursDialog
          key={dialog.request.id}
          title="Edit Request"
          width="640px"
          request={dialog.request}
          categories={categories.map((c) => c.categoryName)}
          saving={editState.saving}
          error={editState.error}
          onClose={() => setDialog(null)}
          onSave={(edited) => handleEdit(dialog.request, edited)}
          onDelete={() => setDialog({ type: "delete", request: dialog.request })}
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          title="Delete Request"
          message={`Delete ${dialog.request.opportunity} for ${studentName(dialog.request)}? This cannot be undone.`}
          confirmLabel={isDeleting ? "Deleting..." : "Delete Request"}
          onConfirm={() => handleDelete(dialog.request)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "bulkDeny" && (
        <ModalShell
          title="Deny Selected Requests"
          width="560px"
          onClose={() => setDialog(null)}
          footer={
            <>
              <SaveButton variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </SaveButton>
              <SaveButton variant="danger" onClick={denySelected} disabled={isReviewing || selectedRequests.length === 0}>
                Deny {selectedRequests.length}
              </SaveButton>
            </>
          }
        >
          <div className="club-requests-dialog-body">
            <p className="club-requests-dialog-lead">
              Deny {plural(selectedRequests.length, "request")}? Each student will see the message below.
            </p>
            <Input
              label="Deny Message (Optional)"
              multiline
              rows={3}
              placeholder="Shown to each student."
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
            />
          </div>
        </ModalShell>
      )}
      {dialog?.type === "photo" && (
        <ModalShell
          title="Submitted Photo"
          width="560px"
          onClose={() => setDialog(null)}
          footer={
            <SaveButton variant="secondary" onClick={() => setDialog(null)}>
              Close
            </SaveButton>
          }
        >
          <div className="club-requests-dialog-body">
            <div className="club-requests-dialog-who">
              {studentName(dialog.request)} · {dialog.request.opportunity} · {dialog.request.date}
            </div>
            {/* TODO: load the photo from the club's image folder using the request's imageId */}
            <div className="club-requests-photo-placeholder">
              <i className="bi bi-image" aria-hidden="true" />
              This photo will open from the club&apos;s image folder.
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
