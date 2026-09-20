import { Router } from "express";
import bcrypt from "bcryptjs";
import { Priority, Role, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { authenticate, allow, validate } from "./middleware.js";
import {
  cookieOptions,
  hashToken,
  saveRefreshToken,
  signAccess,
  signRefresh,
  verifyRefresh,
} from "./auth.js";
import { projectFor, scopeFor, taskFor } from "./access.js";
import {
  emitActivity,
  emitNotification,
  emitNotificationCount,
  onlineUsers,
  disconnectUser
} from "./realtime.js";

const auth = Router();
const api = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

auth.post(
  "/login",
  validate(loginSchema),
  async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
    });

    if (
      !user ||
      !(await bcrypt.compare(
        req.body.password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect",
        },
      });
    }

    const safe = {
      id: user.id,
      role: user.role,
      name: user.name,
    };

    const refresh = signRefresh(safe);

    await saveRefreshToken(
      safe,
      refresh
    );

    return res
      .cookie(
        "refreshToken",
        refresh,
        cookieOptions
      )
      .json({
        data: {
          accessToken: signAccess(safe),
          user: safe,
        },
      });
  }
);

auth.post(
  "/refresh",
  async (req, res) => {
    try {
      const raw = req.cookies.refreshToken;

      if (!raw) {
        return res.status(401).json({
          error: {
            code: "INVALID_REFRESH",
            message: "Refresh token is required",
          },
        });
      }

      const claims = verifyRefresh(raw);

      const stored =
        await prisma.refreshToken.findUnique({
          where: {
            tokenHash: hashToken(raw),
          },
        });

      if (!stored) {
        return res.status(401).json({
          error: {
            code: "INVALID_REFRESH",
            message: "Refresh token is invalid",
          },
        });
      }

      if (stored.expiresAt < new Date()) {
        await prisma.refreshToken.delete({
          where: { id: stored.id },
        });

        return res.status(401).json({
          error: {
            code: "INVALID_REFRESH",
            message: "Refresh token has expired",
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.id },
      });

      if (!user) {
        await prisma.refreshToken.delete({
          where: { id: stored.id },
        });

        return res.status(401).json({
          error: {
            code: "INVALID_REFRESH",
            message: "User no longer exists",
          },
        });
      }

      const safe = {
        id: user.id,
        role: user.role,
        name: user.name,
      };

      const newRefreshToken = signRefresh(safe);

      await prisma.$transaction([
        prisma.refreshToken.delete({
          where: { id: stored.id },
        }),
        prisma.refreshToken.create({
          data: {
            userId: safe.id,
            tokenHash: hashToken(newRefreshToken),
            expiresAt: new Date(
              Date.now() + 7 * 864e5
            ),
          },
        }),
      ]);

      return res
        .cookie(
          "refreshToken",
          newRefreshToken,
          cookieOptions
        )
        .json({
          data: {
            accessToken: signAccess(safe),
            user: safe,
          },
        });
    } catch {
      return res.status(401).json({
        error: {
          code: "INVALID_REFRESH",
          message:
            "Session expired; please sign in again",
        },
      });
    }
  }
);

auth.post(
  "/logout",
  async (req, res) => {
    if (req.cookies.refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: {
          tokenHash: hashToken(
            req.cookies.refreshToken
          ),
        },
      });
    }

    /**
     * Express 5:
     * Do not pass maxAge to clearCookie().
     *
     * The path must match the original cookie
     * so **/

    return res
      .clearCookie(
        "refreshToken",
        {
          httpOnly:
            cookieOptions.httpOnly,

          secure:
            cookieOptions.secure,

          sameSite:
            cookieOptions.sameSite,

          path:
            cookieOptions.path,
        }
      )
      .status(204)
      .end();
  }
);

api.use(authenticate);

api.get("/me", (req, res) =>
  res.json({ data: req.user })
);

api.get(
  "/users",
  allow(Role.ADMIN),
  async (_req, res) =>
    res.json({
      data: await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: [
          { role: "asc" },
          { name: "asc" },
        ],
      }),
    })
);

api.post(
  "/users",
  allow(Role.ADMIN),
  validate(
    z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8).max(128),
      role: z.nativeEnum(Role),
    })
  ),
  async (req, res) => {
    const passwordHash =
      await bcrypt.hash(
        req.body.password,
        12
      );

    const user =
      await prisma.user.create({
        data: {
          name: req.body.name,
          email: req.body.email,
          role: req.body.role,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

    return res.status(201).json({
      data: user,
    });
  }
);

api.patch(
  "/users/:userId",
  allow(Role.ADMIN),
  validate(
    z.object({
      userId: z.string().cuid(),
    }),
    "params"
  ),
  validate(
    z.object({
      name: z.string().min(2).max(100).optional(),
      email: z.string().email().optional(),
      role: z.nativeEnum(Role).optional(),
    })
  ),
  async (req, res) => {
    const userId = req.params.userId as string;

    if (
      userId === req.user!.id &&
      req.body.role &&
      req.body.role !== Role.ADMIN
    ) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "An administrator cannot remove their own administrator access",
        },
      });
    }

    const existing =
      await prisma.user.findUnique({
        where: { id: userId },
      });

    if (!existing) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "User not found",
        },
      });
    }

    const user =
      await prisma.user.update({
        where: { id: userId },
        data: req.body,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      if (
  req.body.role &&
  req.body.role !== existing.role
) {
  disconnectUser(user.id);
}

    return res.json({
      data: user,
    });
  }
);

api.get(
  "/users/developers",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  async (_req, res) =>
    res.json({
      data: await prisma.user.findMany({
        where: {
          role: Role.DEVELOPER,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
    })
);

api.post(
  "/clients",
  allow(Role.ADMIN),
  validate(
    z.object({
      name: z.string().min(2).max(100),
    })
  ),
  async (req, res) =>
    res.status(201).json({
      data: await prisma.client.create({
        data: req.body,
      }),
    })
);

api.get(
  "/clients",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  async (_req, res) =>
    res.json({
      data: await prisma.client.findMany({
        orderBy: {
          name: "asc",
        },
      }),
    })
);

api.patch(
  "/clients/:clientId",
  allow(Role.ADMIN),
  validate(
    z.object({
      clientId: z.string().cuid(),
    }),
    "params"
  ),
  validate(
    z.object({
      name: z.string().min(2).max(100),
    })
  ),
  async (req, res) => {
    const client =
      await prisma.client.findUnique({
        where: {
          id: req.params.clientId as string,
        },
      });

    if (!client) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Client not found",
        },
      });
    }

    return res.json({
      data: await prisma.client.update({
        where: { id: client.id },
        data: req.body,
      }),
    });
  }
);

api.post(
  "/projects",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  validate(
    z.object({
      name: z.string().min(2).max(200),
      description: z.string().max(2000).optional(),
      clientId: z.string().cuid(),
    })
  ),
  async (req, res) => {
    const client =
      await prisma.client.findUnique({
        where: {
          id: req.body.clientId,
        },
      });

    if (!client) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Client not found",
        },
      });
    }

    const project =
      await prisma.project.create({
        data: {
          name: req.body.name,
          description: req.body.description,
          clientId: req.body.clientId,
          creatorId: req.user!.id,
        },
        include: {
          client: true,
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      });

    return res.status(201).json({
      data: project,
    });
  }
);

api.get(
  "/projects",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  async (req, res) => {
    const where =
      req.user!.role === Role.ADMIN
        ? {}
        : {
            creatorId: req.user!.id,
          };

    return res.json({
      data: await prisma.project.findMany({
        where,
        include: {
          client: true,
          _count: {
            select: {
              tasks: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
    });
  }
);

api.patch(
  "/projects/:projectId",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  validate(
    z.object({
      projectId: z.string().cuid(),
    }),
    "params"
  ),
  validate(
    z.object({
      name: z.string().min(2).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      clientId: z.string().cuid().optional(),
    })
  ),
  async (req, res) => {
    const project = await projectFor(
      req.user!,
      req.params.projectId as string
    );

    if (!project) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
        },
      });
    }

    if (req.body.clientId) {
      const client =
        await prisma.client.findUnique({
          where: {
            id: req.body.clientId,
          },
        });

      if (!client) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Client not found",
          },
        });
      }
    }

    const updated =
      await prisma.project.update({
        where: {
          id: project.id,
        },
        data: req.body,
        include: {
          client: true,
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      });

    return res.json({
      data: updated,
    });
  }
);

const taskPayload = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  priority: z.nativeEnum(Priority),
  dueDate: z.coerce.date(),
});

async function validateDeveloper(
  assigneeId: string | null | undefined
) {
  if (!assigneeId) return true;

  const assignee =
    await prisma.user.findUnique({
      where: {
        id: assigneeId,
      },
      select: {
        id: true,
        role: true,
      },
    });

  return !!assignee && assignee.role === Role.DEVELOPER;
}

api.post(
  "/projects/:projectId/tasks",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  validate(
    z.object({
      projectId: z.string().cuid(),
    }),
    "params"
  ),
  validate(taskPayload),
  async (req, res) => {
    const projectId = req.params.projectId as string;

    const project =
      await projectFor(
        req.user!,
        projectId
      );

    if (!project) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
        },
      });
    }

    if (
      !(await validateDeveloper(
        req.body.assigneeId
      ))
    ) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Assignee must be a developer",
        },
      });
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const task =
            await tx.task.create({
              data: {
                title: req.body.title,
                description: req.body.description,
                assigneeId: req.body.assigneeId ?? null,
                priority: req.body.priority,
                dueDate: req.body.dueDate,
                projectId,
              },
              include: {
                project: true,
                assignee: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            });

          let notification = null;

          if (task.assigneeId) {
            notification =
              await tx.notification.create({
                data: {
                  recipientId:
                    task.assigneeId,
                  taskId: task.id,
                  title: "New task assigned",
                  body: `You were assigned ${task.title}`,
                },
              });
          }

          return {
            task,
            notification,
          };
        }
      );

    if (result.notification) {
      emitNotification(
        result.task.assigneeId!,
        result.notification
      );

      await emitNotificationCount(
        result.task.assigneeId!
      );
    }

    return res.status(201).json({
      data: result.task,
    });
  }
);

const taskManagementPayload = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
  dueDate: z.coerce.date().optional(),
});

api.patch(
  "/tasks/:taskId",
  allow(Role.ADMIN, Role.PROJECT_MANAGER),
  validate(
    z.object({
      taskId: z.string().cuid(),
    }),
    "params"
  ),
  validate(taskManagementPayload),
  async (req, res) => {
    const task = await taskFor(
      req.user!,
      req.params.taskId as string
    );

    if (!task) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Task not found",
        },
      });
    }

    if (
      !(await validateDeveloper(
        req.body.assigneeId
      ))
    ) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Assignee must be a developer",
        },
      });
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const updated =
            await tx.task.update({
              where: {
                id: task.id,
              },
              data: req.body,
            });

          let notification = null;

          if (
            updated.assigneeId &&
            updated.assigneeId !== task.assigneeId
          ) {
            notification =
              await tx.notification.create({
                data: {
                  recipientId:
                    updated.assigneeId,
                  taskId: updated.id,
                  title:
                    "New task assigned",
                  body:
                    `You were assigned ${updated.title}`,
                },
              });
          }

          return {
            updated,
            notification,
          };
        }
      );

    if (result.notification) {
      emitNotification(
        result.updated.assigneeId!,
        result.notification
      );

      await emitNotificationCount(
        result.updated.assigneeId!
      );
    }

    return res.json({
      data: result.updated,
    });
  }
);

const taskQuery = z
  .object({
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    dueFrom: z.coerce.date().optional(),
    dueTo: z.coerce.date().optional(),
    projectId: z.string().cuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueTo"],
        message: "dueTo must be on or after dueFrom",
      });
    }
  });

api.get(
  "/tasks",
  validate(taskQuery, "query"),
  async (req, res) => {
    const q = req.query as {
      status?: TaskStatus;
      priority?: Priority;
      dueFrom?: Date;
      dueTo?: Date;
      projectId?: string;
    };

    const where = {
      ...scopeFor(req.user!),
      ...(q.projectId
        ? { projectId: q.projectId }
        : {}),
      ...(q.status
        ? { status: q.status }
        : {}),
      ...(q.priority
        ? { priority: q.priority }
        : {}),
      ...(q.dueFrom || q.dueTo
        ? {
            dueDate: {
              ...(q.dueFrom
                ? { gte: q.dueFrom }
                : {}),
              ...(q.dueTo
                ? { lte: q.dueTo }
                : {}),
            },
          }
        : {}),
    };

    return res.json({
      data: await prisma.task.findMany({
        where,
        include: {
          project: true,
          assignee: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          { priority: "desc" },
          { dueDate: "asc" },
        ],
      }),
    });
  }
);

api.patch(
  "/tasks/:taskId/status",
  validate(
    z.object({
      taskId: z.string().cuid(),
    }),
    "params"
  ),
  validate(
    z.object({
      status: z.nativeEnum(TaskStatus),
    })
  ),
  async (req, res) => {
    const task = await taskFor(
      req.user!,
      req.params.taskId as string
    );

    if (!task) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Task not found",
        },
      });
    }

    if (
      req.user!.role === Role.DEVELOPER &&
      task.assigneeId !== req.user!.id
    ) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "Only the assignee can update this task",
        },
      });
    }

    if (
      task.status === req.body.status
    ) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Task is already in this status",
        },
      });
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          const updated =
            await tx.task.update({
              where: {
                id: task.id,
              },
              data: {
                status:
                  req.body.status,
              },
            });

          const activity =
            await tx.activity.create({
              data: {
                taskId: task.id,
                actorId: req.user!.id,
                previousStatus:
                  task.status,
                newStatus:
                  updated.status,
                message:
                  `${req.user!.name} moved ${task.title} from ${task.status} to ${updated.status}`,
              },
              include: {
                actor: {
                  select: {
                    name: true,
                  },
                },
                task: {
                  select: {
                    title: true,
                    projectId: true,
                    assigneeId: true,
                  },
                },
              },
            });

          let notification = null;

          if (
            updated.status ===
              TaskStatus.IN_REVIEW &&
            task.project.creatorId !==
              req.user!.id
          ) {
            notification =
              await tx.notification.create({
                data: {
                  recipientId:
                    task.project.creatorId,
                  taskId: task.id,
                  title:
                    "Task ready for review",
                  body:
                    `${task.title} moved to In Review`,
                },
              });
          }

          return {
            updated,
            activity,
            notification,
          };
        }
      );

    emitActivity(
      result.activity,
      task.projectId,
      task.assigneeId
    );

    if (result.notification) {
      emitNotification(
        task.project.creatorId,
        result.notification
      );

      await emitNotificationCount(
        task.project.creatorId
      );
    }

    return res.json({
      data: result.updated,
    });
  }
);

api.get(
  "/activities",
  async (req, res) => {
    const scoped = scopeFor(req.user!);

    return res.json({
      data: await prisma.activity.findMany({
        where: {
          task: scoped,
        },
        include: {
          actor: {
            select: {
              name: true,
            },
          },
          task: {
            select: {
              title: true,
              projectId: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      }),
    });
  }
);

api.get(
  "/notifications",
  async (req, res) =>
    res.json({
      data: await prisma.notification.findMany({
        where: {
          recipientId: req.user!.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 30,
      }),
    })
);

api.get(
  "/notifications/unread-count",
  async (req, res) =>
    res.json({
      data: {
        count:
          await prisma.notification.count({
            where: {
              recipientId:
                req.user!.id,
              readAt: null,
            },
          }),
      },
    })
);

api.patch(
  "/notifications/:id/read",
  validate(
    z.object({
      id: z.string().cuid(),
    }),
    "params"
  ),
  async (req, res) => {
    const result =
      await prisma.notification.updateMany({
        where: {
          id: req.params.id as string,
          recipientId: req.user!.id,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

    await emitNotificationCount(
      req.user!.id
    );

    return res.json({
      data: result,
    });
  }
);

api.post(
  "/notifications/read-all",
  async (req, res) => {
    const result =
      await prisma.notification.updateMany({
        where: {
          recipientId:
            req.user!.id,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

    await emitNotificationCount(
      req.user!.id
    );

    return res.json({
      data: result,
    });
  }
);

api.get(
  "/dashboard",
  async (req, res) => {
    const user = req.user!;

    if (user.role === Role.ADMIN) {
      const [projects, tasks, overdue] =
        await Promise.all([
          prisma.project.count(),
          prisma.task.groupBy({
            by: ["status"],
            _count: true,
          }),
          prisma.task.count({
            where: {
              isOverdue: true,
            },
          }),
        ]);

      return res.json({
        data: {
          projects,
          tasks,
          overdue,
          onlineUsers:
            onlineUsers.size,
        },
      });
    }

    if (
      user.role ===
      Role.PROJECT_MANAGER
    ) {
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const endOfWindow = new Date(startOfToday);
      endOfWindow.setDate(
        endOfWindow.getDate() + 7
      );
      endOfWindow.setHours(23, 59, 59, 999);

      const [projects, byPriority, upcoming] =
        await Promise.all([
          prisma.project.count({
            where: {
              creatorId: user.id,
            },
          }),
          prisma.task.groupBy({
            by: ["priority"],
            where: {
              project: {
                creatorId: user.id,
              },
            },
            _count: true,
          }),
          prisma.task.findMany({
            where: {
              project: {
                creatorId: user.id,
              },
              status: {
                not: TaskStatus.DONE,
              },
              dueDate: {
                gte: startOfToday,
                lte: endOfWindow,
              },
            },
            orderBy: {
              dueDate: "asc",
            },
            take: 10,
          }),
        ]);

      return res.json({
        data: {
          projects,
          byPriority,
          upcoming,
        },
      });
    }

    return res.json({
      data: {
        tasks: await prisma.task.findMany({
          where: {
            assigneeId: user.id,
          },
          orderBy: [
            { priority: "desc" },
            { dueDate: "asc" },
          ],
        }),
      },
    });
  }
);

export { auth, api };
