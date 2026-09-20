import { Role } from "@prisma/client";
export type AuthUser = { id: string; role: Role; name: string };
declare global { namespace Express { interface Request { user?: AuthUser } } }
