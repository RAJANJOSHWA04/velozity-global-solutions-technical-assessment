import type {
  NextFunction,
  Request,
  Response
} from "express";

import { Role } from "@prisma/client";
import { ZodError, ZodType } from "zod";

import { prisma } from "./prisma.js";
import { verifyAccess } from "./auth.js";

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers.authorization?.replace(
      /^Bearer\s+/i,
      ""
    );

    if (!token) {
      return res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "A valid access token is required"
        }
      });
    }

    const claims = verifyAccess(token);

    /**
     * IMPORTANT:
     * Do NOT trust role from JWT.
     * Fetch the current user from PostgreSQL.
     */
    const user = await prisma.user.findUnique({
      where: {
        id: claims.id
      },
      select: {
        id: true,
        name: true,
        role: true
      }
    });

    if (!user) {
      return res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "User account no longer exists"
        }
      });
    }

    /**
     * req.user now contains the CURRENT role
     * from PostgreSQL.
     */
    req.user = user;

    next();
  } catch {
    return res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid access token is required"
      }
    });
  }
}

export const allow =
  (...roles: Role[]) =>
  (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (
      !req.user ||
      !roles.includes(req.user.role)
    ) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "You do not have permission for this resource"
        }
      });
    }

    next();
  };

export const validate =
  (
    schema: ZodType,
    part: "body" | "query" | "params" = "body"
  ) =>
  (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const result = schema.safeParse(
      req[part]
    );

    if (!result.success) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: result.error.flatten()
        }
      });
    }

    (req as any)[part] = result.data;

    next();
  };

export function errors(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(err);

  // Invalid JSON sent by client
  if (
    err?.type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON",
      },
    });
  }

  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.flatten(),
      },
    });
  }

  // Preserve known HTTP status codes
  const status =
    typeof err?.statusCode === "number"
      ? err.statusCode
      : typeof err?.status === "number"
        ? err.status
        : 500;

  return res.status(status).json({
    error: {
      code:
        status === 404
          ? "NOT_FOUND"
          : "INTERNAL_ERROR",
      message:
        status === 404
          ? "Route not found"
          : "An unexpected error occurred",
    },
  });
}