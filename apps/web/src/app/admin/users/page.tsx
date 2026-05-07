"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { alpha } from "@mui/material/styles";
import type { UserGender, UserRestrictions, UserStatus } from "@ignara/sharedtypes";
import { apiRequest } from "../../../lib/api";
import { useAuthStore, type SessionUser } from "../../../store/auth-store";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

type OrgUser = {
  id: string;
  orgId: string;
  email: string;
  role: "admin" | "manager" | "employee";
  gender?: UserGender;
  tagDeviceId?: string | null;
  status?: UserStatus;
  restrictions?: UserRestrictions;
};

const STATUS_COLORS: Record<string, "success" | "error" | "warning" | "default"> = {
  active: "success",
  banned: "error",
  restricted: "warning",
};

const RESTRICTION_LABELS: { key: keyof UserRestrictions; label: string; description: string }[] = [
  { key: "chat", label: "Chat", description: "Block text chat access" },
  { key: "voice", label: "Voice", description: "Block voice call access" },
  { key: "location", label: "Location", description: "Block location tracking" },
  { key: "notifications", label: "Notifications", description: "Block notification access" },
];

export default function AdminUsersPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Create user form
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "manager" | "employee">("employee");
  const [newGender, setNewGender] = useState<UserGender>("other");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit user dialog
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "manager" | "employee">("employee");
  const [editGender, setEditGender] = useState<UserGender>("other");
  const [editStatus, setEditStatus] = useState<UserStatus>("active");
  const [editRestrictions, setEditRestrictions] = useState<UserRestrictions>({});
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      let sessionUser = user;
      if (!sessionUser) {
        const me = await apiRequest<{ user: SessionUser }>("/auth/me");
        sessionUser = me.user;
        setUser(sessionUser);
      }

      if (sessionUser.role !== "admin") {
        router.replace("/dashboard");
        return;
      }

      const data = await apiRequest<OrgUser[]>("/users");
      setUsers(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, [router, setUser, user]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // ── Create User ────────────────────────────────────────────────────
  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);

    if (!newEmail.trim() || !newPassword.trim()) {
      setCreateError("Email and password are required");
      return;
    }

    if (newPassword.length < 6) {
      setCreateError("Password must be at least 6 characters");
      return;
    }

    try {
      setIsCreating(true);
      const created = await apiRequest<OrgUser>("/users", {
        method: "POST",
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
          gender: newGender,
        }),
      });

      setUsers((prev) => [...prev, created].sort((a, b) => a.email.localeCompare(b.email)));
      setShowCreateDialog(false);
      setNewEmail("");
      setNewPassword("");
      setNewRole("employee");
      setNewGender("other");
      setActionStatus(`Created account for ${created.email}`);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  }

  // ── Edit User ──────────────────────────────────────────────────────
  function openEditDialog(target: OrgUser) {
    setEditingUser(target);
    setEditEmail(target.email);
    setEditPassword("");
    setEditRole(target.role);
    setEditGender(target.gender ?? "other");
    setEditStatus(target.status ?? "active");
    setEditRestrictions(target.restrictions ?? {});
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingUser) return;
    setEditError(null);

    const body: Record<string, unknown> = {};

    if (editEmail.trim() !== editingUser.email) {
      if (!editEmail.trim()) {
        setEditError("Email cannot be empty");
        return;
      }
      body.email = editEmail.trim();
    }

    if (editPassword.trim()) {
      if (editPassword.length < 6) {
        setEditError("Password must be at least 6 characters");
        return;
      }
      body.password = editPassword;
    }

    if (editRole !== editingUser.role) body.role = editRole;
    if (editGender !== (editingUser.gender ?? "other")) body.gender = editGender;
    if (editStatus !== (editingUser.status ?? "active")) body.status = editStatus;

    const oldRestrictions = editingUser.restrictions ?? {};
    const changed = RESTRICTION_LABELS.some(({ key }) => editRestrictions[key] !== oldRestrictions[key]);
    if (changed) body.restrictions = editRestrictions;

    if (Object.keys(body).length === 0) {
      setEditingUser(null);
      return;
    }

    try {
      setIsSaving(true);
      const updated = await apiRequest<OrgUser>(`/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)).sort((a, b) => a.email.localeCompare(b.email)),
      );
      setEditingUser(null);
      setActionStatus(`Updated ${updated.email}`);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "Failed to update user");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Quick Status Toggle ────────────────────────────────────────────
  async function toggleBan(target: OrgUser) {
    const nextStatus: UserStatus = target.status === "banned" ? "active" : "banned";
    try {
      const updated = await apiRequest<OrgUser>(`/users/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setActionStatus(`${updated.email} is now ${nextStatus}`);
    } catch (caught) {
      setActionStatus(caught instanceof Error ? caught.message : "Action failed");
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────
  async function handleDelete(target: OrgUser) {
    if (!window.confirm(`Permanently delete ${target.email}? This cannot be undone.`)) return;
    try {
      setDeletingUserId(target.id);
      await apiRequest<{ ok: boolean }>(`/users/${target.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      setActionStatus(`Deleted ${target.email}`);
    } catch (caught) {
      setActionStatus(caught instanceof Error ? caught.message : "Delete failed");
    } finally {
      setDeletingUserId(null);
    }
  }

  if (user && user.role !== "admin") {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">Only administrators can access user management.</Alert>
      </Container>
    );
  }

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      (u.status ?? "active").toLowerCase().includes(q)
    );
  });

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 } }}>
      <Stack spacing={4}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <Card
          elevation={0}
          sx={(theme) => ({
            p: { xs: 2.5, md: 3.5 },
            borderRadius: 4,
            backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 55%),
              linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.14)}, transparent 60%)`,
          })}
        >
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: "bold" }}>
                Administration
              </Typography>
              <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>
                User Management
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Create, update, ban, and restrict user accounts in your organization.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              <Chip color="primary" label={`${users.length} users`} />
              <Chip
                color="success"
                variant="outlined"
                label={`${users.filter((u) => (u.status ?? "active") === "active").length} active`}
              />
              <Chip
                color="error"
                variant="outlined"
                label={`${users.filter((u) => u.status === "banned").length} banned`}
              />
              <Button variant="contained" onClick={() => setShowCreateDialog(true)}>
                Create User
              </Button>
            </Box>
          </Box>
        </Card>

        {/* ── Status messages ────────────────────────────────────── */}
        {error && <Alert severity="error">{error}</Alert>}
        {actionStatus && (
          <Alert severity="info" onClose={() => setActionStatus(null)}>
            {actionStatus}
          </Alert>
        )}

        {/* ── Search Bar ─────────────────────────────────────────── */}
        {!isLoading && users.length > 0 && (
          <TextField
            fullWidth
            placeholder="Search users by email, role, or status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ bgcolor: "background.paper", borderRadius: 1 }}
          />
        )}

        {/* ── User cards ─────────────────────────────────────────── */}
        {isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading users...
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {filteredUsers.map((target) => {
              const status = target.status ?? "active";
              const restrictions = target.restrictions ?? {};
              const activeRestrictions = RESTRICTION_LABELS.filter(({ key }) => restrictions[key]);
              const isSelf = target.id === user?.sub;

              return (
                <Grid item xs={12} sm={6} lg={4} key={target.id}>
                  <Paper
                    elevation={0}
                    sx={(theme) => ({
                      p: 2.5,
                      border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                      borderLeft: `4px solid ${
                        status === "banned"
                          ? theme.palette.error.main
                          : status === "restricted"
                          ? theme.palette.warning.main
                          : theme.palette.success.main
                      }`,
                      borderRadius: 3,
                      opacity: status === "banned" ? 0.7 : 1,
                      transition: "all 0.2s ease",
                      "&:hover": {
                        boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, 0.08)}`,
                      },
                    })}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1.5 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="subtitle1"
                          fontWeight="bold"
                          sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {target.email}
                        </Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                          <Chip
                            size="small"
                            label={target.role}
                            color={target.role === "admin" ? "primary" : target.role === "manager" ? "secondary" : "default"}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={status}
                            color={STATUS_COLORS[status] ?? "default"}
                          />
                          {isSelf && <Chip size="small" label="You" variant="outlined" color="info" />}
                        </Stack>
                      </Box>
                    </Box>

                    {activeRestrictions.length > 0 && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Restricted:
                        </Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                          {activeRestrictions.map(({ key, label }) => (
                            <Chip key={key} size="small" label={label} color="warning" variant="outlined" />
                          ))}
                        </Stack>
                      </Box>
                    )}

                    {target.tagDeviceId && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        Tag: {target.tagDeviceId}
                      </Typography>
                    )}

                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                      <Button size="small" variant="outlined" onClick={() => openEditDialog(target)} disabled={isSelf}>
                        Edit
                      </Button>
                      {!isSelf && (
                        <Button
                          size="small"
                          variant="outlined"
                          color={status === "banned" ? "success" : "error"}
                          onClick={() => void toggleBan(target)}
                        >
                          {status === "banned" ? "Unban" : "Ban"}
                        </Button>
                      )}
                      {!isSelf && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => void handleDelete(target)}
                          disabled={deletingUserId === target.id}
                        >
                          {deletingUserId === target.id ? "Deleting..." : "Delete"}
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              );
            })}

            {users.length === 0 && !isLoading && (
              <Grid item xs={12}>
                <Paper sx={{ p: 4, textAlign: "center" }}>
                  <Typography variant="body1" color="text.secondary">
                    No users found. Create the first user to get started.
                  </Typography>
                </Paper>
              </Grid>
            )}

            {users.length > 0 && filteredUsers.length === 0 && !isLoading && (
              <Grid item xs={12}>
                <Paper sx={{ p: 4, textAlign: "center" }}>
                  <Typography variant="body1" color="text.secondary">
                    No users match your search query "{searchQuery}".
                  </Typography>
                </Paper>
              </Grid>
            )}
          </Grid>
        )}
      </Stack>

      {/* ── Create User Dialog ────────────────────────────────────── */}
      <Dialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <Box component="form" onSubmit={handleCreate}>
          <DialogTitle sx={{ fontWeight: 700 }}>Create New User</DialogTitle>
          <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
            <Typography variant="body2" color="text.secondary">
              Create a new user account. They will be able to log in with the credentials you set.
            </Typography>

            <TextField
              fullWidth
              label="Email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
            />

            <TextField
              fullWidth
              type="password"
              label="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              helperText="At least 6 characters"
            />

            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}>
                <MenuItem value="employee">Employee</MenuItem>
                <MenuItem value="manager">Manager</MenuItem>
                <MenuItem value="admin">Admin</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>Gender</InputLabel>
              <Select label="Gender" value={newGender} onChange={(e) => setNewGender(e.target.value as UserGender)}>
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="female">Female</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            {createError && <Alert severity="error">{createError}</Alert>}
          </DialogContent>
          <DialogActions sx={{ p: 2.5 }}>
            <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create User"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* ── Edit User Dialog ──────────────────────────────────────── */}
      <Dialog
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Edit User — {editingUser?.email}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
          />

          <TextField
            fullWidth
            type="password"
            label="New Password"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
            autoComplete="new-password"
            helperText="Leave blank to keep current password"
          />

          <FormControl fullWidth size="small">
            <InputLabel>Role</InputLabel>
            <Select label="Role" value={editRole} onChange={(e) => setEditRole(e.target.value as typeof editRole)}>
              <MenuItem value="employee">Employee</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Gender</InputLabel>
            <Select label="Gender" value={editGender} onChange={(e) => setEditGender(e.target.value as UserGender)}>
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as UserStatus)}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="banned">Banned</MenuItem>
              <MenuItem value="restricted">Restricted</MenuItem>
            </Select>
          </FormControl>

          <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
              Feature Restrictions
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              Toggle features this user is blocked from using.
            </Typography>
            {RESTRICTION_LABELS.map(({ key, label, description }) => (
              <FormControlLabel
                key={key}
                control={
                  <Checkbox
                    checked={Boolean(editRestrictions[key])}
                    onChange={(e) =>
                      setEditRestrictions((prev) => ({
                        ...prev,
                        [key]: e.target.checked,
                      }))
                    }
                    color="warning"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {description}
                    </Typography>
                  </Box>
                }
                sx={{ mb: 0.5, alignItems: "flex-start" }}
              />
            ))}
          </Paper>

          {editError && <Alert severity="error">{editError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setEditingUser(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSaveEdit()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
