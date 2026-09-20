import "express-async-errors";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./config.js";
import { errors } from "./middleware.js";
import { auth, api } from "./routes.js";
import { initRealtime } from "./realtime.js";
import { startOverdueTaskScheduler } from "./jobs.js";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(cookieParser());

app.get(
  "/health",
  (_req, res) =>
    res.json({
      data: {
        ok: true,
      },
    })
);

app.use(
  "/api/auth",
  auth
);

app.use(
  "/api",
  api
);

app.use(
  (_req, res) =>
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    })
);

app.use(errors);

const server =
  http.createServer(app);

initRealtime(server);

/**
 * Start DB-backed overdue scheduler.
 */
startOverdueTaskScheduler();

const port = Number(process.env.PORT) || 4000;

server.listen(port, "0.0.0.0", () => {
  console.log(`API listening on ${port}`);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});