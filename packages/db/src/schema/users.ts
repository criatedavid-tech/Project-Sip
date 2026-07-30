import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";

/**
 * Identidade global: um usuário pode pertencer a várias organizações.
 * Por isso esta tabela não tem organization_id nem RLS por tenant — o vínculo
 * (e o isolamento) vive em organization_users.
 */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: primaryId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [uniqueIndex("roles_key_unique").on(table.key)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: primaryId(),
    key: text("key").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [uniqueIndex("permissions_key_unique").on(table.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: primaryId(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("role_permissions_unique").on(table.roleId, table.permissionId),
  ],
);

export const organizationUsers = pgTable(
  "organization_users",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_users_unique").on(table.organizationId, table.userId),
    index("organization_users_user_idx").on(table.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationUsers),
}));

export const organizationUsersRelations = relations(organizationUsers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationUsers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [organizationUsers.userId], references: [users.id] }),
  role: one(roles, { fields: [organizationUsers.roleId], references: [roles.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));
