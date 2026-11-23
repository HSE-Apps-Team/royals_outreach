"use client";

import { useState } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import CoordinatorFrame from "../coordinatorFrame";
import PageTitle from "@/app/components/pageTitle";
import StatCard from "@/app/components/statCard";
import SectionHead from "@/app/components/sectionHead";
import Input from "@/app/components/input";
import SaveButton from "@/app/components/saveButton";
import Badge from "@/app/components/badge";
import { useToast } from "@/app/context/ToastContext";
import { formatHours } from "@/lib/formatHours";

import {
  approveAsCoordinator,
  denyAsCoordinator,
  type CoordinatorPageData,
  type CoordinatorRequest,
} from "@/actions/coordinator";

type CoordinatorUIProps = {
  token: string;
  data: CoordinatorPageData;
};

export default function CoordinatorUI({ token, data }: CoordinatorUIProps) {
  const { showToast } = useToast();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const { coordinatorName, orgName, waiting, history } = data;
  const orgLine = [orgName, coordinatorName && `Coordinator ${coordinatorName}`].filter(Boolean).join(" · ");

  const review = async (request: CoordinatorRequest, decision: "approve" | "deny") => {
    setBusyId(request.id);
    const result =
      decision === "approve"
        ? await approveAsCoordinator(token, request.id)
        : await denyAsCoordinator(token, request.id, notes[request.id] ?? "");
    setBusyId(null);

    if (!result.success) {
      showToast(result.error, "danger");
      return;
    }
    setNotes((prev) => {
      const next = { ...prev };
      delete next[request.id];
      return next;
    });
    showToast(decision === "approve" ? "Approved. Thank you!" : "Marked as denied.", decision === "approve" ? "success" : "info");
  };

  return (
    <CoordinatorFrame>
      <PageTitle align="left" subtitle={orgLine || undefined}>
        Confirm Volunteer Hours
      </PageTitle>

      <div className="coordinator-thanks">
        <i className="bi bi-heart-fill coordinator-thanks-icon" aria-hidden="true" />
        Thank you for helping us verify service hours.
      </div>

      {/* Stats */}
      <div className="coordinator-stats">
        <StatCard tone="solid" label="Waiting On You" value={waiting.length} icon="hourglass-split" />
        <StatCard label="Confirmed This Month" value={data.confirmedThisMonth} icon="check-circle-fill" />
        <StatCard label="Volunteer Hours" value={formatHours(data.confirmedHours)} icon="clock" />
      </div>

      {/* Requests To Confirm */}
      <section>
        <SectionHead>Requests To Confirm</SectionHead>
        {waiting.length === 0 ? (
          <div className="coordinator-done" role="status">
            No requests waiting. You are all caught up.
          </div>
        ) : (
          <div className="coordinator-cards">
            {waiting.map((r) => {
              const busy = busyId === r.id;
              return (
                <article key={r.id} className="coordinator-card" aria-busy={busy}>
                  <h3 className="coordinator-card-student">{r.student}</h3>
                  <div className="coordinator-card-opportunity">{r.opportunity}</div>
                  <div className="coordinator-card-meta">{[r.date, r.gradClass].filter(Boolean).join(" · ")}</div>
                  <div className="coordinator-card-hours">{formatHours(r.hours)}</div>

                  {r.studentMessage && (
                    <div className="coordinator-card-message">
                      <strong>Note from student:</strong> {r.studentMessage}
                    </div>
                  )}

                  <Input
                    label="Message To Student (Optional)"
                    placeholder="Only sent if you deny."
                    multiline
                    rows={3}
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={busy}
                  />

                  <div className="coordinator-card-actions">
                    <SaveButton
                      size="sm"
                      icon="check-lg"
                      fullWidth
                      disabled={busyId !== null}
                      onClick={() => review(r, "approve")}
                    >
                      Approve
                    </SaveButton>
                    <SaveButton
                      size="sm"
                      variant="danger"
                      fullWidth
                      disabled={busyId !== null}
                      onClick={() => review(r, "deny")}
                    >
                      Deny
                    </SaveButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Previous Decisions */}
      {history.length > 0 && (
        <section>
          <SectionHead>Previous Decisions</SectionHead>
          <ul className="coordinator-history">
            {history.map((h) => (
              <li key={h.id} className="coordinator-history-row">
                <div className="coordinator-history-main">
                  <span className="coordinator-history-student">{h.student}</span>
                  <span className="coordinator-history-detail">
                    {" "}
                    · {h.opportunity} · {h.date}
                  </span>
                  {h.message && <div className="coordinator-history-message">Your message: {h.message}</div>}
                </div>
                <span className="coordinator-history-hours">{formatHours(h.hours)}</span>
                <Badge tone={h.decision === "Approved" ? "approved" : "denied"}>{h.decision}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="coordinator-email-note">
        You get one email the morning after a student names you{orgName ? ` for ${orgName}` : ""}, then a weekly
        reminder while any request is still waiting for your answer.
      </p>
    </CoordinatorFrame>
  );
}
