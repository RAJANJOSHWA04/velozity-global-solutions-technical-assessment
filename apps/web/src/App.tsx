import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { io } from "socket.io-client";
import { api, getToken, refresh, setToken } from "./api";

type Role = "ADMIN" | "PROJECT_MANAGER" | "DEVELOPER";
type User = { id: string; name: string; role: Role };
type Person = User & { email: string; createdAt?: string };
type Project = {
  id: string;
  name: string;
  description?: string;
  client: { id: string; name: string };
  _count: { tasks: number };
};
type Developer = { id: string; name: string; email: string };
type Task = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate: string;
  isOverdue: boolean;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
};
type Activity = {
  id: string;
  message: string;
  createdAt: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  actor: { name: string };
  task: { title: string; projectId: string };
};
type Notice = {
  id: string;
  title: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
};
type Client = { id: string; name: string };
type Dashboard = {
  projects?: number;
  tasks?: { status: string; _count: number }[];
  overdue?: number;
  onlineUsers?: number;
  byPriority?: { priority: string; _count: number }[];
  upcoming?: Task[];
};
const API_ORIGIN = (
  import.meta.env.VITE_API_URL ?? "http://localhost:4000/api"
).replace(/\/api$/, "");
const labels: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  DONE: "Done",
};
const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const roles: Record<Role, string> = {
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project Manager",
  DEVELOPER: "Developer",
};

function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} min${Math.floor(seconds / 60) === 1 ? "" : "s"} ago`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)} hr${Math.floor(seconds / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.floor(seconds / 86400)} day${Math.floor(seconds / 86400) === 1 ? "" : "s"} ago`;
}
function readableStatus(value: string) {
  return labels[value] ?? value;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("admin@velozity.test"),
    [password, setPassword] = useState("Password123!"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API_ORIGIN}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error.message);
      setToken(b.data.accessToken);
      onLogin(b.data.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login">
      <section>
        <p className="eyebrow">VELOZITY</p>
        <h1>
          Project pulse,
          <br />
          in real time.
        </h1>
        <p>Internal delivery workspace for teams that move quickly.</p>
      </section>
      <form onSubmit={submit}>
        <h2>Sign in</h2>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={loading}>
          {loading ? "Signing in…" : "Continue"}
        </button>
        <small>Seed password: Password123!</small>
      </form>
    </main>
  );
}

function ProjectForm({
  clients,
  project,
  onCreated,
  onClose,
}: {
  clients: Client[];
  project?: Project;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      name: form.get("name"),
      description: form.get("description") || null,
      clientId: form.get("clientId"),
    };
    try {
      await api(project ? `/projects/${project.id}` : "/projects", {
        method: project ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={project ? "Manage project" : "Create project"}
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit}>
        <label>
          Project name
          <input
            name="name"
            defaultValue={project?.name}
            minLength={2}
            required
            autoFocus
          />
        </label>
        <label>
          Client
          <select name="clientId" defaultValue={project?.client.id} required>
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={project?.description ?? ""}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button>{project ? "Save project" : "Create project"}</button>
      </form>
    </Modal>
  );
}
function ClientForm({
  client,
  onCreated,
  onClose,
}: {
  client?: Client;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const form = new FormData(e.currentTarget);
      await api(client ? `/clients/${client.id}` : "/clients", {
        method: client ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.get("name") }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={client ? "Manage client" : "Add client"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          Client name
          <input
            name="name"
            defaultValue={client?.name}
            minLength={2}
            required
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button>{client ? "Save client" : "Add client"}</button>
      </form>
    </Modal>
  );
}
function UserForm({
  onCreated,
  onClose,
}: {
  onCreated: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const form = new FormData(e.currentTarget);
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role: form.get("role"),
        }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Add team member" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          Full name
          <input name="name" minLength={2} required autoFocus />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Temporary password
          <input name="password" type="password" minLength={8} required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="DEVELOPER">
            {Object.entries(roles).map(([key, value]) => (
              <option value={key} key={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button>Add team member</button>
      </form>
    </Modal>
  );
}
function TaskForm({
  projects,
  developers,
  task,
  onSaved,
  onClose,
}: {
  projects: Project[];
  developers: Developer[];
  task?: Task;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const projectId = task?.project?.id ?? projects[0]?.id;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      title: f.get("title"),
      description: f.get("description") || undefined,
      assigneeId: f.get("assigneeId") || null,
      priority: f.get("priority"),
      dueDate: f.get("dueDate"),
    };
    try {
      if (task)
        await api(`/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      else
        await api(`/projects/${f.get("projectId")}/tasks`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={task ? "Manage task" : "Create task"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!task && (
          <label>
            Project
            <select name="projectId" defaultValue={projectId} required>
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Task title
          <input
            name="title"
            defaultValue={task?.title}
            minLength={2}
            required
            autoFocus
          />
        </label>
        <label>
          Assigned developer
          <select name="assigneeId" defaultValue={task?.assignee?.id ?? ""}>
            <option value="">Unassigned</option>
            {developers.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="two-fields">
          <label>
            Priority
            <select name="priority" defaultValue={task?.priority ?? "MEDIUM"}>
              {priorities.map((p) => (
                <option value={p} key={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input
              name="dueDate"
              type="date"
              defaultValue={task?.dueDate.slice(0, 10)}
              required
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={task?.description ?? ""}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button>{task ? "Save task" : "Create task"}</button>
      </form>
    </Modal>
  );
}

function Metric({
  title,
  value,
  danger,
}: {
  title: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <article className="metric">
      <span>{title}</span>
      <b className={danger ? "danger" : ""}>{value}</b>
    </article>
  );
}
function ActivityPanel({ feed }: { feed: Activity[] }) {
  return (
    <aside className="panel activity-panel">
      <div className="panel-head">
        <h2>Live activity</h2>
        <i className="live">● LIVE</i>
      </div>
      {feed.map((activity) => {
        const line =
          activity.previousStatus && activity.newStatus
            ? `${activity.actor.name} moved ${activity.task.title} from ${readableStatus(activity.previousStatus)} → ${readableStatus(activity.newStatus)}`
            : activity.message;
        return (
          <article className="activity" key={activity.id}>
            <div className="avatar">{activity.actor.name[0]}</div>
            <p>
              <strong>{line}</strong>
              <small>{relativeTime(activity.createdAt)}</small>
            </p>
          </article>
        );
      })}
      {!feed.length && <p className="muted">No recent activity.</p>}
    </aside>
  );
}

function App() {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const projectsRef = useRef<Project[]>([]);
  const [user, setUser] = useState<User>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dash, setDash] = useState<Dashboard>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [filter, setFilter] = useState(new URLSearchParams(location.search));
  const [view, setView] = useState<"dashboard" | "projects" | "team">(
    "dashboard",
  );
  const [modal, setModal] = useState<
    | "project"
    | "edit-project"
    | "client"
    | "edit-client"
    | "user"
    | "task"
    | "edit-task"
    | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<Task>();
  const [selectedProject, setSelectedProject] = useState<Project>();
  const [selectedClient, setSelectedClient] = useState<Client>();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    refresh()
      .then((x) => setUser(x.user))
      .catch(() => {});
  }, []);
 
const load = async () => {
  if (!user) return;

  const query = filter.toString();
  const dueFrom = filter.get("dueFrom");
  const dueTo = filter.get("dueTo");

  // Prevent invalid date ranges from being sent to the API.
  if (dueFrom && dueTo && dueFrom > dueTo) {
    setError("Due To must be on or after Due From");
    return;
  }

  // Clear any previous error before starting a new request.
  setError("");

  try {
    const [
      allTasks,
      activities,
      allNotices,
      summary,
      allProjects,
      allClients,
      allDevs,
    ] = await Promise.all([
      api<Task[]>(query ? `/tasks?${query}` : "/tasks"),
      api<Activity[]>("/activities"),
      api<Notice[]>("/notifications"),
      api<Dashboard>("/dashboard"),
      user.role === "DEVELOPER"
        ? Promise.resolve([] as Project[])
        : api<Project[]>("/projects"),
      user.role === "DEVELOPER"
        ? Promise.resolve([] as Client[])
        : api<Client[]>("/clients"),
      user.role === "DEVELOPER"
        ? Promise.resolve([] as Developer[])
        : api<Developer[]>("/users/developers"),
    ]);

    setTasks(allTasks);
    setFeed(activities);
    setNotices(allNotices);
    setDash(summary);
    setProjects(allProjects);
    setClients(allClients);
    setDevelopers(allDevs);

    if (user.role === "ADMIN") {
      setMembers(await api<Person[]>("/users"));
    }

    // Clear any old error after a successful reload.
    setError("");
  } catch (e) {
    setError((e as Error).message);
  }
};

  useEffect(() => {
    load();
  }, [user, filter]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const s = io(API_ORIGIN, { autoConnect: false, transports: ["websocket"] });
    socketRef.current = s;

    const connectSocket = async () => {
      try {
        let accessToken = getToken();
        if (!accessToken) {
          const x = await refresh();
          accessToken = x.accessToken;
        }
        if (!live) return;
        s.auth = { token: accessToken };
        s.connect();
      } catch {}
    };

    s.on("connect", async () => {
      if (user.role === "PROJECT_MANAGER") {
        projectsRef.current.forEach((p) => s.emit("project:join", p.id));
      }

      try {
        const latest = await api<Activity[]>("/activities");
        if (!live) return;
        setFeed((current) => {
          const merged = [...latest, ...current];
          const unique = Array.from(
            new Map(merged.map((a) => [a.id, a])).values(),
          );
          unique.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          return unique.slice(0, 20);
        });
      } catch {}

      try {
        const [latestNotifications, unreadData] = await Promise.all([
          api<Notice[]>("/notifications"),
          api<{ count: number }>("/notifications/unread-count"),
        ]);

        if (!live) return;

        setNotices(latestNotifications);
        setUnreadCount(unreadData.count);
      } catch {}
    });

    s.on("activity:new", (activity: Activity) => {
      setFeed((current) => {
        const merged = [
          activity,
          ...current.filter((a) => a.id !== activity.id),
        ];
        merged.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return merged.slice(0, 20);
      });
    });

    s.on("notification:new", (notice: Notice) => {
      setNotices((current) =>
        current.some((n) => n.id === notice.id)
          ? current
          : [notice, ...current],
      );
    });

    s.on("notification:count", (count: number) => {
      setUnreadCount(count);
    });

    s.on("presence:count", (onlineUsers: number) => {
      setDash((current) => (current ? { ...current, onlineUsers } : current));
    });

    s.on("connect_error", async () => {
      try {
        const x = await refresh();
        if (!live) return;
        s.auth = { token: x.accessToken };
        if (!s.connected) s.connect();
      } catch {}
    });

    connectSocket();

    return () => {
      live = false;
      s.disconnect();
      if (socketRef.current === s) socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "PROJECT_MANAGER") return;
    const s = socketRef.current;
    if (!s || !s.connected) return;
    projects.forEach((p) => s.emit("project:join", p.id));
  }, [projects, user]);

  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(filter);
    value ? next.set(key, value) : next.delete(key);
    history.replaceState({}, "", `?${next}`);
    setFilter(next);
  }
  async function updateStatus(task: Task, status: string) {
    try {
      await api(`/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTasks((current) =>
        current.map((t) => (t.id === task.id ? { ...t, status } : t)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH" });
      setNotices((current) =>
        current.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function markAllRead() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setNotices((current) =>
        current.map((n) => ({
          ...n,
          readAt: n.readAt ?? new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function changeMemberRole(member: Person, role: Role) {
    try {
      const updated = await api<Person>(`/users/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setMembers((current) =>
        current.map((item) => (item.id === member.id ? updated : item)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setToken("");
    setUser(undefined);
    setNotificationsOpen(false);
  }
  function openEdit(task: Task) {
    setSelectedTask(task);
    setModal("edit-task");
  }
  if (!user) return <Login onLogin={setUser} />;
  const canManage = user.role !== "DEVELOPER";
  const metrics =
    user.role === "ADMIN" ? (
      <>
        <Metric title="Projects" value={dash?.projects ?? "—"} />
        <Metric title="Overdue" value={dash?.overdue ?? "—"} danger />
        <Metric title="Online now" value={dash?.onlineUsers ?? "—"} />
        {dash?.tasks?.map((item) => (
          <Metric
            key={item.status}
            title={readableStatus(item.status)}
            value={item._count}
          />
        ))}
      </>
    ) : user.role === "PROJECT_MANAGER" ? (
      <>
        <Metric title="My projects" value={dash?.projects ?? "—"} />
        {dash?.byPriority?.map((item) => (
          <Metric
            key={item.priority}
            title={`${item.priority} priority`}
            value={item._count}
          />
        ))}
      </>
    ) : (
      <>
        <Metric title="Assigned tasks" value={tasks.length} />
        <Metric
          title="Overdue"
          value={tasks.filter((t) => t.isOverdue).length}
          danger
        />
      </>
    );
  return (
    <main className="app">
      <header>
        <div>
          <p className="eyebrow">VELOZITY / INTERNAL</p>
          <h1>Good morning, {user.name.split(" ")[0]}.</h1>
          <nav>
            <button
              className={view === "dashboard" ? "nav-active" : ""}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
            {canManage && (
              <button
                className={view === "projects" ? "nav-active" : ""}
                onClick={() => setView("projects")}
              >
                Projects
              </button>
            )}
            {user.role === "ADMIN" && (
              <button
                className={view === "team" ? "nav-active" : ""}
                onClick={() => setView("team")}
              >
                Team
              </button>
            )}
          </nav>
        </div>
        <div className="header-actions">
          <div className="notification-wrap">
            <button
              className="badge"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              {unreadCount} notifications
            </button>
            {notificationsOpen && (
              <section className="notifications-popover">
                <div className="popover-title">
                  <strong>Notifications</strong>
                  {unreadCount > 0 && (
                    <button className="text-button" onClick={markAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notices.length ? (
                  notices.slice(0, 8).map((n) => (
                    <button
                      className={n.readAt ? "notice read" : "notice"}
                      key={n.id}
                      onClick={() => !n.readAt && markRead(n.id)}
                    >
                      <strong>{n.title}</strong>
                      <small>
                        {n.body} · {relativeTime(n.createdAt)}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className="muted">You are all caught up.</p>
                )}
              </section>
            )}
          </div>
          <button className="secondary-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {error && (
        <p className="page-error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      {view === "dashboard" && (
        <>
          <section className="metrics">{metrics}</section>
          {user.role === "PROJECT_MANAGER" && dash?.upcoming && (
            <section className="upcoming">
              <strong>Due this week</strong>
              {dash.upcoming.length ? (
                dash.upcoming.map((t) => (
                  <span key={t.id}>
                    {t.title} · {new Date(t.dueDate).toLocaleDateString()}
                  </span>
                ))
              ) : (
                <span>No tasks due this week.</span>
              )}
            </section>
          )}
          <section className="grid">
            <section className="panel tasks">
              <div className="panel-head">
                <h2>
                  {user.role === "DEVELOPER"
                    ? "My assigned tasks"
                    : "Task board"}
                </h2>
                {canManage && (
                  <button
                    className="primary-small"
                    onClick={() => setModal("task")}
                  >
                    + New task
                  </button>
                )}
              </div>
              <div className="filters">
                <select
                  aria-label="Status filter"
                  onChange={(e) => changeFilter("status", e.target.value)}
                  value={filter.get("status") ?? ""}
                >
                  <option value="">All statuses</option>
                  {Object.entries(labels).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Priority filter"
                  onChange={(e) => changeFilter("priority", e.target.value)}
                  value={filter.get("priority") ?? ""}
                >
                  <option value="">All priorities</option>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
                <label>
                  From
                  <input
                    aria-label="Due from"
                    type="date"
                    value={filter.get("dueFrom") ?? ""}
                    onChange={(e) => changeFilter("dueFrom", e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    aria-label="Due to"
                    type="date"
                    value={filter.get("dueTo") ?? ""}
                    onChange={(e) => changeFilter("dueTo", e.target.value)}
                  />
                </label>
              </div>
              {tasks.map((task) => (
                <article className="task" key={task.id}>
                  <div>
                    <span className={`priority ${task.priority.toLowerCase()}`}>
                      {task.priority}
                    </span>
                    <strong>{task.title}</strong>
                    <p>
                      {task.project?.name} ·{" "}
                      {task.assignee?.name ?? "Unassigned"} · due{" "}
                      {new Date(task.dueDate).toLocaleDateString()}{" "}
                      {task.isOverdue && <em>OVERDUE</em>}
                    </p>
                  </div>
                  <div className="task-actions">
                    <select
                      aria-label={`Status for ${task.title}`}
                      value={task.status}
                      onChange={(e) => updateStatus(task, e.target.value)}
                    >
                      {Object.entries(labels).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                    {canManage && (
                      <button
                        className="text-button"
                        onClick={() => openEdit(task)}
                      >
                        Manage
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!tasks.length && (
                <p className="muted empty">
                  No tasks match this shareable URL filter.
                </p>
              )}
            </section>
            <ActivityPanel feed={feed} />
          </section>
        </>
      )}
      {view === "projects" && (
        <section className="management">
          <div className="management-head">
            <div>
              <p className="eyebrow">DELIVERY</p>
              <h2>Projects</h2>
            </div>
            <div className="action-row">
              {user.role === "ADMIN" && (
                <button
                  className="secondary-button"
                  onClick={() => setModal("client")}
                >
                  + Client
                </button>
              )}
              <button
                className="primary-small"
                onClick={() => setModal("project")}
              >
                + Project
              </button>
            </div>
          </div>
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <p className="eyebrow">{project.client.name}</p>
                <h3>{project.name}</h3>
                <p>{project.description || "No description added."}</p>
                <footer>
                  <span>{project._count.tasks} tasks</span>
                  <div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelectedProject(project);
                        setModal("edit-project");
                      }}
                    >
                      Manage
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setFilter(
                          new URLSearchParams(`projectId=${project.id}`),
                        );
                        history.replaceState(
                          {},
                          "",
                          `?projectId=${project.id}`,
                        );
                        setView("dashboard");
                      }}
                    >
                      View tasks
                    </button>
                  </div>
                </footer>
              </article>
            ))}
            {!projects.length && (
              <p className="muted">
                Create a client and your first project to begin.
              </p>
            )}
          </div>
          {user.role === "ADMIN" && (
            <section className="client-list">
              <h3>Clients</h3>
              {clients.map((client) => (
                <div key={client.id}>
                  <span>{client.name}</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelectedClient(client);
                      setModal("edit-client");
                    }}
                  >
                    Manage
                  </button>
                </div>
              ))}
            </section>
          )}
        </section>
      )}
      {view === "team" && (
        <section className="management">
          <div className="management-head">
            <div>
              <p className="eyebrow">ADMINISTRATION</p>
              <h2>Team members</h2>
            </div>
            <button className="primary-small" onClick={() => setModal("user")}>
              + Team member
            </button>
          </div>
          <section className="panel table-panel">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>
                      <select
                        className="role-select"
                        value={member.role}
                        disabled={member.id === user.id}
                        onChange={(e) =>
                          changeMemberRole(member, e.target.value as Role)
                        }
                      >
                        {Object.entries(roles).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      )}
      {modal === "project" && (
        <ProjectForm
          clients={clients}
          onCreated={load}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {modal === "edit-project" && selectedProject && (
        <ProjectForm
          clients={clients}
          project={selectedProject}
          onCreated={load}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {modal === "client" && (
        <ClientForm onCreated={load} onClose={() => setModal(null)} />
      )}{" "}
      {modal === "edit-client" && selectedClient && (
        <ClientForm
          client={selectedClient}
          onCreated={load}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {modal === "user" && (
        <UserForm onCreated={load} onClose={() => setModal(null)} />
      )}{" "}
      {modal === "task" && (
        <TaskForm
          projects={projects}
          developers={developers}
          onSaved={load}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {modal === "edit-task" && selectedTask && (
        <TaskForm
          projects={projects}
          developers={developers}
          task={selectedTask}
          onSaved={load}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}
export default App;
