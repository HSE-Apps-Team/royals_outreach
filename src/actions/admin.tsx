"use server";

import { db } from "@/db";
import { adminUserData } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CURRENT_ADMIN_ID } from "@/lib/currentAdmin";

export type CurrentAdmin = {
  adminId: number;
  fName: string;
  lName: string;
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

export const getCurrentAdmin = async (): Promise<CurrentAdmin | null> => {
  const [admin] = await db.select().from(adminUserData).where(eq(adminUserData.adminId, CURRENT_ADMIN_ID));
  if (!admin) return null;

  return { adminId: admin.adminId, fName: admin.fName ?? "", lName: admin.lName ?? "" };
};
