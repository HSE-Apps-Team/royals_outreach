import { pgTable, integer, numeric, text, boolean, date, time, timestamp, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Hours allow quarter, half and tenth hours (0.25, 0.5, 0.6), so they are stored as
// numeric(6, 2) and read back as JS numbers.
const hoursColumn = () => numeric("hours", { precision: 6, scale: 2, mode: "number" });

// ============================================================
//  USERS
// ============================================================

// Emails are matched case-insensitively against the login email, so each
// user table gets a lower(email) unique index to make that a DB guarantee.

// ---------------- student_user_data ----------------
// student_id is the school-issued ID, so it is not generated.
export const studentUserData = pgTable("student_user_data", {
  studentId: integer("student_id").primaryKey(),
  email:     text("email"),
  fName:     text("f_name"),
  lName:     text("l_name"),
  gradClass: integer("grad_class"),
}, (t) => ({
  emailLowerUnique: uniqueIndex("student_user_data_email_lower_unique").on(sql`lower(${t.email})`),
}));

// ---------------- admin_user_data ----------------
export const adminUserData = pgTable("admin_user_data", {
  adminId: integer("admin_id").primaryKey().generatedAlwaysAsIdentity(),
  email:   text("email"),
  fName:   text("f_name"),
  lName:   text("l_name"),
}, (t) => ({
  emailLowerUnique: uniqueIndex("admin_user_data_email_lower_unique").on(sql`lower(${t.email})`),
}));

// ---------------- staff_user_data ----------------
export const staffUserData = pgTable("staff_user_data", {
  staffId: integer("staff_id").primaryKey().generatedAlwaysAsIdentity(),
  email:   text("email"),
  fName:   text("f_name"),
  lName:   text("l_name"),
}, (t) => ({
  emailLowerUnique: uniqueIndex("staff_user_data_email_lower_unique").on(sql`lower(${t.email})`),
}));

// ============================================================
//  CLUBS
// ============================================================

// ---------------- club_data ----------------
export const clubData = pgTable("club_data", {
  clubId:         integer("club_id").primaryKey().generatedAlwaysAsIdentity(),
  clubName:       text("club_name"),
  execNeedsHours: boolean("exec_needs_hours"),
  clubLogoFileId: text("club_logo_file_id"),
  doubleDipping:  boolean("double_dipping"),
  // Admins delete clubs by setting this, so students' logged hours keep the club and
  // category names. Deleted clubs are hidden from every list and their panel 404s.
  isDeleted:      boolean("is_deleted").notNull().default(false),
});

// ---------------- category_data ----------------
export const categoryData = pgTable("category_data", {
  categoryId:             integer("category_id").primaryKey().generatedAlwaysAsIdentity(),
  clubId:                 integer("club_id").references(() => clubData.clubId),
  categoryName:           text("category_name"),
  needsEmailVerification: boolean("needs_email_verification"),
  goal:                   integer("goal"),
  needsClubConfirmation:  boolean("needs_club_confirmation"),
});

// ---------------- student_club_membership ----------------
export const studentClubMembership = pgTable("student_club_membership", {
  num:       integer("num").primaryKey().generatedAlwaysAsIdentity(),
  clubId:    integer("club_id").references(() => clubData.clubId),
  studentId: integer("student_id").references(() => studentUserData.studentId),
  membership_status:    boolean("membership_status"),
  is_exec:    boolean("is_exec"),
});

// ---------------- club_staff_assignment ----------------
export const clubStaffAssignment = pgTable("club_staff_assignment", {
  num:     integer("num").primaryKey().generatedAlwaysAsIdentity(),
  clubId:  integer("club_id").references(() => clubData.clubId),
  staffId: integer("staff_id").references(() => staffUserData.staffId),
});

// ============================================================
//  MEMBER GROUPS
// ============================================================

// ---------------- club_member_groups ----------------
export const clubMemberGroups = pgTable("club_member_groups", {
  groupId:   integer("group_id").primaryKey().generatedAlwaysAsIdentity(),
  clubId:    integer("club_id").references(() => clubData.clubId),
  groupName: text("group_name"),
});

// ---------------- category_club_group_assignment ----------------
export const categoryClubGroupAssignment = pgTable("category_club_group_assignment", {
  num:        integer("num").primaryKey().generatedAlwaysAsIdentity(),
  groupId:    integer("group_id").references(() => clubMemberGroups.groupId),
  categoryId: integer("category_id").references(() => categoryData.categoryId),
});

// ---------------- student_club_group_assignment ----------------
export const studentClubGroupAssignment = pgTable("student_club_group_assignment", {
  num:       integer("num").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => studentUserData.studentId),
  groupId:   integer("group_id").references(() => clubMemberGroups.groupId),
});

// ============================================================
//  ROLES & PERMISSIONS
// ============================================================

// ---------------- permissions_list ----------------
export const permissionsList = pgTable("permissions_list", {
  permissionId:       integer("permission_id").primaryKey().generatedAlwaysAsIdentity(),
  permissionKey:      text("permission_key"),
  description:        text("description"),
  permissionCategory: text("permission_category"),
});

// ---------------- role_data ----------------
export const roleData = pgTable("role_data", {
  roleId:   integer("role_id").primaryKey().generatedAlwaysAsIdentity(),
  clubId:   integer("club_id").references(() => clubData.clubId),
  roleName: text("role_name"),
});

// ---------------- role_permissions ----------------
export const rolePermissions = pgTable("role_permissions", {
  num:          integer("num").primaryKey().generatedAlwaysAsIdentity(),
  roleId:       integer("role_id").references(() => roleData.roleId),
  permissionId: integer("permission_id").references(() => permissionsList.permissionId),
});

// ---------------- student_role_assignment ----------------
export const studentRoleAssignment = pgTable("student_role_assignment", {
  num:       integer("num").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => studentUserData.studentId),
  clubId:    integer("club_id").references(() => clubData.clubId),
  roleId:    integer("role_id").references(() => roleData.roleId),
});

// ============================================================
//  HOURS
// ============================================================

// ---------------- logged_hours ----------------
export const loggedHours = pgTable("logged_hours", {
  num:              integer("num").primaryKey().generatedAlwaysAsIdentity(),
  studentId:        integer("student_id").references(() => studentUserData.studentId),
  clubId:           integer("club_id").references(() => clubData.clubId),
  opportunityName:  text("opportunity_name"),
  date:             date("date"),
  hours:            hoursColumn(),
  categoryId:       integer("category_id").references(() => categoryData.categoryId),
  orgName:          text("org_name"),
  coordinatorName:  text("coordinator_name"),
  coordinatorEmail: text("coordinator_email"),
  optionalMessage:  text("optional_message"),
  denyMessage:      text("deny_message"),
  status:           text("status"),
  imageId:          text("image_id"),
  // Null on rows logged before this column was added.
  submittedAt:      timestamp("submitted_at", { withTimezone: true }).defaultNow(),
  // What the coordinator decided on the coordinator page ("Approved" or "Denied"). The club can
  // still change the status afterward, so this keeps the coordinator's own answer.
  coordinatorDecision:  text("coordinator_decision"),
  coordinatorDecidedAt: timestamp("coordinator_decided_at", { withTimezone: true }),
  // When this request was last in the coordinator's daily email. Null means they have not
  // been told about it yet (a new request, or the student changed the coordinator's email).
  coordinatorEmailedAt: timestamp("coordinator_emailed_at", { withTimezone: true }),
  // When the request last became Approved or Denied, by anyone. Null while it is pending, and on
  // rows decided before this column was added. The staff weekly summary counts by it.
  decidedAt:            timestamp("decided_at", { withTimezone: true }),
  // The student's email about the club's approve or deny, scheduled in Resend a few minutes
  // ahead so an Undo can cancel it. Rows in one email share its id. The email has gone out
  // once student_email_send_at is past. See src/lib/studentEmails.ts.
  studentEmailId:     text("student_email_id"),
  studentEmailSendAt: timestamp("student_email_send_at", { withTimezone: true }),
});

// ---------------- additional_hours ----------------
export const additionalHours = pgTable("additional_hours", {
  num:        integer("num").primaryKey().generatedAlwaysAsIdentity(),
  studentId:  integer("student_id").references(() => studentUserData.studentId),
  clubId:     integer("club_id").references(() => clubData.clubId),
  hours:      hoursColumn(),
  categoryId: integer("category_id").references(() => categoryData.categoryId),
});

// ============================================================
//  SIGN UPS
// ============================================================

// ---------------- sign_ups ----------------
export const signUps = pgTable("sign_ups", {
  signUpId:        integer("sign_up_id").primaryKey().generatedAlwaysAsIdentity(),
  categoryId:      integer("category_id").references(() => categoryData.categoryId),
  name:            text("name"),
  description:     text("description"),
  date:            text("date"),
  startTime:       text("start_time"),
  endTime:         text("end_time"),
  location:        text("location"),
  slots:          integer("slots"),
  hours:           hoursColumn(),
  slotsPerStudent: integer("slots_per_student"),
});

// ---------------- registrations ----------------
export const registrations = pgTable("registrations", {
  num:            integer("num").primaryKey().generatedAlwaysAsIdentity(),
  signUpId:       integer("sign_up_id").references(() => signUps.signUpId),
  studentId:      integer("student_id").references(() => studentUserData.studentId),
  timeRegistered: text("time_registered"),
  status:         text("status"),
});

// ============================================================
//  EVENTS
// ============================================================

// Required club meetings. An event is assigned to member groups, and the expected roster is
// worked out when it is read (everyone in those groups), so a student who changes groups after
// the event is created still shows up in the right events. Only marked students get a row in
// club_event_attendance. Events never add service hours.

// ---------------- club_events ----------------
export const clubEvents = pgTable("club_events", {
  eventId:     integer("event_id").primaryKey().generatedAlwaysAsIdentity(),
  clubId:      integer("club_id").notNull().references(() => clubData.clubId),
  name:        text("name").notNull(),
  description: text("description"),
  date:        date("date").notNull(),
});

// ---------------- club_event_times ----------------
// One event can be held more than once on its date (before and after school). The times share
// one attendance record, so a member only needs to come to one of them. Every event has at least one.
export const clubEventTimes = pgTable("club_event_times", {
  timeId:    integer("time_id").primaryKey().generatedAlwaysAsIdentity(),
  eventId:   integer("event_id").notNull().references(() => clubEvents.eventId, { onDelete: "cascade" }),
  label:     text("label"),
  startTime: time("start_time").notNull(),
  endTime:   time("end_time").notNull(),
  location:  text("location").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  endAfterStart: check("club_event_times_end_after_start", sql`${t.endTime} > ${t.startTime}`),
}));

// ---------------- club_event_groups ----------------
// Deleting a member group removes it from its events; the events and their attendance stay.
export const clubEventGroups = pgTable("club_event_groups", {
  num:     integer("num").primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer("event_id").notNull().references(() => clubEvents.eventId, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => clubMemberGroups.groupId, { onDelete: "cascade" }),
}, (t) => ({
  eventGroupUnique: uniqueIndex("club_event_groups_event_group_unique").on(t.eventId, t.groupId),
}));

// ---------------- club_event_attendance ----------------
// One row per marked student, so marking is an upsert on (event_id, student_id). A student with
// no row is Not Marked. time_id is the time they came to (Present and Late only).
export const clubEventAttendance = pgTable("club_event_attendance", {
  num:       integer("num").primaryKey().generatedAlwaysAsIdentity(),
  eventId:   integer("event_id").notNull().references(() => clubEvents.eventId, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull(),
  status:    text("status").notNull(),
  timeId:    integer("time_id").references(() => clubEventTimes.timeId, { onDelete: "set null" }),
  method:    text("method").notNull(),
  // A club member outside the event's groups whom an exec chose to add.
  isWalkIn:  boolean("is_walk_in").notNull().default(false),
  markedAt:  timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Named by hand: the generated name is 64 characters, past Postgres's 63, so drizzle-kit would
  // see the shortened name as a different constraint on every push.
  studentFk: foreignKey({
    name:           "club_event_attendance_student_id_fk",
    columns:        [t.studentId],
    foreignColumns: [studentUserData.studentId],
  }),
  eventStudentUnique: uniqueIndex("club_event_attendance_event_student_unique").on(t.eventId, t.studentId),
  statusCheck: check("club_event_attendance_status_check", sql`${t.status} in ('Present', 'Late', 'Excused', 'Absent')`),
  methodCheck: check("club_event_attendance_method_check", sql`${t.method} in ('Scanned', 'Search', 'Manual')`),
}));

// ============================================================
//  RELATIONS
// ============================================================

export const studentRelations = relations(studentUserData, ({ many }) => ({
  memberships:     many(studentClubMembership),
  groups:          many(studentClubGroupAssignment),
  roles:           many(studentRoleAssignment),
  loggedHours:     many(loggedHours),
  additionalHours: many(additionalHours),
  registrations:   many(registrations),
  eventAttendance: many(clubEventAttendance),
}));

export const staffRelations = relations(staffUserData, ({ many }) => ({
  clubs: many(clubStaffAssignment),
}));

export const clubRelations = relations(clubData, ({ many }) => ({
  categories:      many(categoryData),
  memberships:     many(studentClubMembership),
  staff:           many(clubStaffAssignment),
  groups:          many(clubMemberGroups),
  roles:           many(roleData),
  loggedHours:     many(loggedHours),
  additionalHours: many(additionalHours),
  events:          many(clubEvents),
}));

export const categoryRelations = relations(categoryData, ({ one, many }) => ({
  club:            one(clubData, {
    fields:     [categoryData.clubId],
    references: [clubData.clubId],
  }),
  groups:          many(categoryClubGroupAssignment),
  signUps:         many(signUps),
  loggedHours:     many(loggedHours),
  additionalHours: many(additionalHours),
}));

export const studentClubMembershipRelations = relations(studentClubMembership, ({ one }) => ({
  club:    one(clubData, {
    fields:     [studentClubMembership.clubId],
    references: [clubData.clubId],
  }),
  student: one(studentUserData, {
    fields:     [studentClubMembership.studentId],
    references: [studentUserData.studentId],
  }),
}));

export const clubStaffAssignmentRelations = relations(clubStaffAssignment, ({ one }) => ({
  club:  one(clubData, {
    fields:     [clubStaffAssignment.clubId],
    references: [clubData.clubId],
  }),
  staff: one(staffUserData, {
    fields:     [clubStaffAssignment.staffId],
    references: [staffUserData.staffId],
  }),
}));

export const clubMemberGroupRelations = relations(clubMemberGroups, ({ one, many }) => ({
  club:       one(clubData, {
    fields:     [clubMemberGroups.clubId],
    references: [clubData.clubId],
  }),
  categories: many(categoryClubGroupAssignment),
  students:   many(studentClubGroupAssignment),
  events:     many(clubEventGroups),
}));

export const categoryClubGroupAssignmentRelations = relations(categoryClubGroupAssignment, ({ one }) => ({
  group:    one(clubMemberGroups, {
    fields:     [categoryClubGroupAssignment.groupId],
    references: [clubMemberGroups.groupId],
  }),
  category: one(categoryData, {
    fields:     [categoryClubGroupAssignment.categoryId],
    references: [categoryData.categoryId],
  }),
}));

export const studentClubGroupAssignmentRelations = relations(studentClubGroupAssignment, ({ one }) => ({
  student: one(studentUserData, {
    fields:     [studentClubGroupAssignment.studentId],
    references: [studentUserData.studentId],
  }),
  group:   one(clubMemberGroups, {
    fields:     [studentClubGroupAssignment.groupId],
    references: [clubMemberGroups.groupId],
  }),
}));

export const permissionRelations = relations(permissionsList, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const roleRelations = relations(roleData, ({ one, many }) => ({
  club:        one(clubData, {
    fields:     [roleData.clubId],
    references: [clubData.clubId],
  }),
  permissions: many(rolePermissions),
  students:    many(studentRoleAssignment),
}));

export const rolePermissionRelations = relations(rolePermissions, ({ one }) => ({
  role:       one(roleData, {
    fields:     [rolePermissions.roleId],
    references: [roleData.roleId],
  }),
  permission: one(permissionsList, {
    fields:     [rolePermissions.permissionId],
    references: [permissionsList.permissionId],
  }),
}));

export const studentRoleAssignmentRelations = relations(studentRoleAssignment, ({ one }) => ({
  student: one(studentUserData, {
    fields:     [studentRoleAssignment.studentId],
    references: [studentUserData.studentId],
  }),
  club:    one(clubData, {
    fields:     [studentRoleAssignment.clubId],
    references: [clubData.clubId],
  }),
  role:    one(roleData, {
    fields:     [studentRoleAssignment.roleId],
    references: [roleData.roleId],
  }),
}));

export const loggedHoursRelations = relations(loggedHours, ({ one }) => ({
  student:  one(studentUserData, {
    fields:     [loggedHours.studentId],
    references: [studentUserData.studentId],
  }),
  club:     one(clubData, {
    fields:     [loggedHours.clubId],
    references: [clubData.clubId],
  }),
  category: one(categoryData, {
    fields:     [loggedHours.categoryId],
    references: [categoryData.categoryId],
  }),
}));

export const additionalHoursRelations = relations(additionalHours, ({ one }) => ({
  student:  one(studentUserData, {
    fields:     [additionalHours.studentId],
    references: [studentUserData.studentId],
  }),
  club:     one(clubData, {
    fields:     [additionalHours.clubId],
    references: [clubData.clubId],
  }),
  category: one(categoryData, {
    fields:     [additionalHours.categoryId],
    references: [categoryData.categoryId],
  }),
}));

export const signUpRelations = relations(signUps, ({ one, many }) => ({
  category:      one(categoryData, {
    fields:     [signUps.categoryId],
    references: [categoryData.categoryId],
  }),
  registrations: many(registrations),
}));

export const registrationRelations = relations(registrations, ({ one }) => ({
  signUp:  one(signUps, {
    fields:     [registrations.signUpId],
    references: [signUps.signUpId],
  }),
  student: one(studentUserData, {
    fields:     [registrations.studentId],
    references: [studentUserData.studentId],
  }),
}));

export const clubEventRelations = relations(clubEvents, ({ one, many }) => ({
  club:       one(clubData, {
    fields:     [clubEvents.clubId],
    references: [clubData.clubId],
  }),
  times:      many(clubEventTimes),
  groups:     many(clubEventGroups),
  attendance: many(clubEventAttendance),
}));

export const clubEventTimeRelations = relations(clubEventTimes, ({ one, many }) => ({
  event:      one(clubEvents, {
    fields:     [clubEventTimes.eventId],
    references: [clubEvents.eventId],
  }),
  attendance: many(clubEventAttendance),
}));

export const clubEventGroupRelations = relations(clubEventGroups, ({ one }) => ({
  event: one(clubEvents, {
    fields:     [clubEventGroups.eventId],
    references: [clubEvents.eventId],
  }),
  group: one(clubMemberGroups, {
    fields:     [clubEventGroups.groupId],
    references: [clubMemberGroups.groupId],
  }),
}));

export const clubEventAttendanceRelations = relations(clubEventAttendance, ({ one }) => ({
  event:   one(clubEvents, {
    fields:     [clubEventAttendance.eventId],
    references: [clubEvents.eventId],
  }),
  student: one(studentUserData, {
    fields:     [clubEventAttendance.studentId],
    references: [studentUserData.studentId],
  }),
  time:    one(clubEventTimes, {
    fields:     [clubEventAttendance.timeId],
    references: [clubEventTimes.timeId],
  }),
}));
