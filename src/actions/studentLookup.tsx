"use server";

import { db } from "@/db";
import { studentUserData } from "@/db/schema";
import { getStudentGoalProgress, getStudentRequests, type ClubGoalProgress, type MyRequest } from "@/actions/hours";

/** A student in the Look Up Students search. Clubs and hours load when the student is picked. */
export type StudentIndexEntry = {
  studentId: number;
  fName: string;
  lName: string;
  email: string;
  gradClass: number | null;
};

/** One student's clubs (inactive memberships too) and every request they logged. */
export type StudentLookupDetail = {
  clubs: ClubGoalProgress[];
  requests: MyRequest[];
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every student in the school, by last name then first name.
// TODO: check the session is staff or admin once auth is added
export const getStudentIndex = async (): Promise<StudentIndexEntry[]> => {
  const students = await db
    .select({
      studentId: studentUserData.studentId,
      fName: studentUserData.fName,
      lName: studentUserData.lName,
      email: studentUserData.email,
      gradClass: studentUserData.gradClass,
    })
    .from(studentUserData)
    .orderBy(studentUserData.lName, studentUserData.fName);

  return students.map((s) => ({
    studentId: s.studentId,
    fName: s.fName ?? "",
    lName: s.lName ?? "",
    email: s.email ?? "",
    gradClass: s.gradClass,
  }));
};

// Every club involvement, not just the clubs the staff member sponsors.
export const getStudentLookupDetail = async (studentId: number): Promise<StudentLookupDetail> => {
  const [clubs, requests] = await Promise.all([getStudentGoalProgress(studentId), getStudentRequests(studentId)]);
  return { clubs, requests };
};
