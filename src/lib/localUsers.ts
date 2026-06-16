import { menuSections } from "./menu";

export type LocalUserRole = "admin" | "operator";

export type LocalUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: LocalUserRole;
  active: boolean;
  permissions: string[];
  createdAt: string;
};

export type CurrentUser = Omit<LocalUser, "password">;

export const LOCAL_USERS_KEY = "movy.localUsers";
export const ALL_PERMISSIONS = "*";

export const permissionOptions = menuSections.flatMap((section) =>
  section.items.map((item) => ({
    section: section.title,
    label: item.label,
    path: item.path,
  })),
);

const defaultAdmin: LocalUser = {
  id: "local-admin",
  name: "Leandro",
  email: "leandroeuroenge@gmail.com",
  password: "Legod35715982465*",
  role: "admin",
  active: true,
  permissions: [ALL_PERMISSIONS],
  createdAt: new Date().toISOString(),
};

function normalizeDefaultAdmin(users: LocalUser[]) {
  const withoutLegacyAdmin = users.filter((user) => user.id !== defaultAdmin.id && user.email.toLowerCase() !== "admin@admin.com");
  const existingAdmin = users.find((user) => user.id === defaultAdmin.id || user.email.toLowerCase() === defaultAdmin.email);
  return [
    {
      ...defaultAdmin,
      createdAt: existingAdmin?.createdAt || defaultAdmin.createdAt,
    },
    ...withoutLegacyAdmin.filter((user) => user.email.toLowerCase() !== defaultAdmin.email),
  ];
}

function withoutPassword(user: LocalUser): CurrentUser {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

export function getLocalUsers() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "[]") as LocalUser[];
    const users = normalizeDefaultAdmin(stored);
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
    return users;
  } catch {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify([defaultAdmin]));
    return [defaultAdmin];
  }
}

export function saveLocalUsers(users: LocalUser[]) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

export function createLocalUser(input: Omit<LocalUser, "id" | "createdAt">) {
  const users = getLocalUsers();
  const email = input.email.trim().toLowerCase();

  if (!email) throw new Error("Informe o email do usuario.");
  if (!input.password.trim()) throw new Error("Informe uma senha.");
  if (users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("Ja existe um usuario com esse email.");
  }

  const user: LocalUser = {
    ...input,
    id: crypto.randomUUID(),
    email,
    createdAt: new Date().toISOString(),
    permissions: input.role === "admin" ? [ALL_PERMISSIONS] : input.permissions,
  };

  saveLocalUsers([user, ...users]);
  return user;
}

export function updateLocalUser(id: string, patch: Partial<LocalUser>) {
  const users = getLocalUsers();
  const nextUsers = users.map((user) => {
    if (user.id !== id) return user;
    const nextRole = patch.role ?? user.role;
    return {
      ...user,
      ...patch,
      permissions: nextRole === "admin" ? [ALL_PERMISSIONS] : patch.permissions ?? user.permissions,
    };
  });
  saveLocalUsers(nextUsers);
  return nextUsers.find((user) => user.id === id);
}

export function removeLocalUser(id: string) {
  const users = getLocalUsers();
  const target = users.find((user) => user.id === id);
  if (target?.role === "admin" && users.filter((user) => user.role === "admin").length <= 1) {
    throw new Error("Mantenha pelo menos um administrador ativo.");
  }
  saveLocalUsers(users.filter((user) => user.id !== id));
}

export function authenticateLocalUser(emailOrLogin: string, password: string) {
  const normalizedLogin = emailOrLogin.trim().toLowerCase();
  const normalizedEmail = normalizedLogin === "admin" ? defaultAdmin.email : normalizedLogin;
  const user = getLocalUsers().find((item) => item.email.toLowerCase() === normalizedEmail);
  if (!user || !user.active || user.password !== password.trim()) return null;
  return withoutPassword(user);
}

export function hasPermission(user: CurrentUser | null, path: string) {
  if (!user) return false;
  if (user.role === "admin" || user.permissions.includes(ALL_PERMISSIONS)) return true;
  return user.permissions.includes(path);
}

export function firstAllowedPath(user: CurrentUser | null) {
  if (!user) return "/auth";
  if (user.role === "admin" || user.permissions.includes(ALL_PERMISSIONS)) return "/";
  return user.permissions[0] || "/auth";
}
