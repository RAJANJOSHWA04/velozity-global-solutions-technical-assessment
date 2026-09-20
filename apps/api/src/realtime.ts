import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Role } from "@prisma/client";
import { z } from "zod";
import { env } from "./config.js";
import { verifyAccess } from "./auth.js";
import { prisma } from "./prisma.js";
import type { AuthUser } from "./types.js";

export const onlineUsers = new Set<string>();

let io: Server | undefined;

async function getSocketUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
    },
  });

  return user;
}

function broadcastPresence() {
  if (!io) return;
  io.emit("presence:count", onlineUsers.size);
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
    transports: ["websocket"],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (typeof token !== "string" || !token) {
        return next(new Error("Unauthorized"));
      }

      const claims = verifyAccess(token);
      const user = await getSocketUser(claims.id);

      if (!user) {
        return next(new Error("Unauthorized"));
      }

      socket.data.user = user;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;

    onlineUsers.add(user.id);
    broadcastPresence();

    socket.join(`user:${user.id}`);

    if (user.role === Role.ADMIN) {
      socket.join("admins");
    }

    socket.on(
      "project:join",
      async (
        projectId: unknown,
        callback?: (result: {
          ok: boolean;
          error?: string;
        }) => void
      ) => {
        try {
          const parsed = z.string().cuid().safeParse(projectId);

          if (!parsed.success) {
            callback?.({
              ok: false,
              error: "Invalid project ID",
            });
            return;
          }

          if (user.role !== Role.PROJECT_MANAGER) {
            callback?.({
              ok: false,
              error: "Project room access denied",
            });
            return;
          }

          const project = await prisma.project.findUnique({
            where: { id: parsed.data },
            select: {
              id: true,
              creatorId: true,
            },
          });

          if (!project) {
            callback?.({
              ok: false,
              error: "Project not found",
            });
            return;
          }

          if (project.creatorId !== user.id) {
            callback?.({
              ok: false,
              error: "Project room access denied",
            });
            return;
          }

          socket.join(`project:${project.id}`);

          callback?.({ ok: true });
        } catch {
          callback?.({
            ok: false,
            error: "Unable to join project",
          });
        }
      }
    );

    socket.on("disconnect", () => {
      const stillConnected =
        io
          ? [...io.sockets.sockets.values()].some((connectedSocket) => {
              const connectedUser =
                connectedSocket.data.user as AuthUser | undefined;
              return connectedUser?.id === user.id;
            })
          : false;

      if (!stillConnected) {
        onlineUsers.delete(user.id);
      }

      broadcastPresence();
    });
  });

  return io;
}

export function emitActivity(
  activity: unknown,
  projectId: string,
  assigneeId: string | null
) {
  if (!io) return;

  io.to(`project:${projectId}`).emit(
    "activity:new",
    activity
  );

  io.to("admins").emit(
    "activity:new",
    activity
  );

  if (assigneeId) {
    io.to(`user:${assigneeId}`).emit(
      "activity:new",
      activity
    );
  }
}

export function emitNotification(
  userId: string,
  notification: unknown
) {
  if (!io) return;

  io.to(`user:${userId}`).emit(
    "notification:new",
    notification
  );
}

export async function emitNotificationCount(userId: string) {
  if (!io) return;

  const count = await prisma.notification.count({
    where: {
      recipientId: userId,
      readAt: null,
    },
  });

  io.to(`user:${userId}`).emit(
    "notification:count",
    count
  );
}

/**
 * Disconnect every active Socket.IO connection
 * belonging to a user.
 *
 * Used when an Admin changes that user's role,
 * so the user's existing socket reconnects and
 * gets the current role from PostgreSQL.
 */
export function disconnectUser(
  userId: string
) {
  if (!io) {
    return;
  }

  for (const socket of io.sockets.sockets.values()) {
    const socketUser =
      socket.data.user as
        | AuthUser
        | undefined;

    if (socketUser?.id === userId) {
      socket.disconnect(true);
    }
  }
}
