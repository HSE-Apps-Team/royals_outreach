"use client";

import { useCallback, useRef, useState } from "react";
import PageTitle from "./pageTitle";
import StudentLookup, { type LookupStudent } from "./studentLookup";
import type { HourRequest } from "./requestRow";
import "../css/staff.css";
import { useToast } from "../context/ToastContext";
import { getStudentLookupDetail, type StudentIndexEntry, type StudentLookupDetail } from "@/actions/studentLookup";
import { updateClubRequest } from "@/actions/clubRequests";

type StudentLookupViewProps = {
  students: StudentIndexEntry[];
};

/**
 * The Look Up Students page body for staff and admins, wired to the student lookup actions.
 * Search runs over every student in the school; a student's clubs and hours are fetched
 * when their tab is shown, so the page never loads the whole school's hours at once.
 */
export default function StudentLookupView({ students }: StudentLookupViewProps) {
  const { showToast } = useToast();
  const [details, setDetails] = useState<Record<number, StudentLookupDetail>>({});
  const requested = useRef(new Set<number>());

  const load = useCallback(
    async (studentId: number) => {
      try {
        const detail = await getStudentLookupDetail(studentId);
        setDetails((prev) => ({ ...prev, [studentId]: detail }));
      } catch {
        requested.current.delete(studentId);
        showToast("Could not load that student. Please try again.", "danger");
      }
    },
    [showToast],
  );

  const onShow = useCallback(
    (id: string) => {
      const studentId = Number(id);
      if (requested.current.has(studentId)) return;
      requested.current.add(studentId);
      load(studentId);
    },
    [load],
  );

  const lookupStudents: LookupStudent[] = students.map((s) => {
    const detail = details[s.studentId];
    return {
      id: String(s.studentId),
      fName: s.fName,
      lName: s.lName,
      email: s.email,
      gradYear: s.gradClass,
      studentId: String(s.studentId),
      loading: !detail,
      clubs: (detail?.clubs ?? []).map((c) => ({
        name: c.clubName,
        goal: c.goal,
        exec: c.isExec,
        inactive: !c.isActive,
        categories: c.categories.map((k) => ({ name: k.name, goal: k.goal, value: k.value })),
        added: c.added,
        earned: c.earned,
      })),
      logs: detail?.requests ?? [],
    };
  });

  // Staff can edit hours, date and status in any club; the category stays as logged
  const saveLog = async (edited: HourRequest) => {
    const owner = Object.entries(details).find(([, d]) => d.requests.some((r) => r.id === edited.id));
    const request = owner?.[1].requests.find((r) => r.id === edited.id);
    if (!owner || !request || request.clubId === null) return;

    try {
      const result = await updateClubRequest(request.clubId, request.id, {
        hours: edited.hours,
        isoDate: edited.isoDate ?? request.isoDate,
        categoryId: request.categoryId,
        status: edited.status,
      });
      if (!result.success) {
        showToast(result.error, "danger");
        return;
      }
      await load(Number(owner[0]));
      showToast("Logged hours updated.", "success");
    } catch {
      showToast("Could not save those hours. Please try again.", "danger");
    }
  };

  return (
    <div className="staff-lookup">
      <PageTitle
        align="left"
        subtitle="Search by name, email or student ID to see hours, clubs and requests."
        style={{ margin: 0 }}
      >
        Look Up Students
      </PageTitle>

      <StudentLookup students={lookupStudents} onShow={onShow} onSaveLog={saveLog} />
    </div>
  );
}
