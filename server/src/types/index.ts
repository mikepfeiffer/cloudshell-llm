import { Request } from 'express';

export interface AuthenticatedUser {
  oid: string;
  name?: string;
  email?: string;
  tenantId: string;
  accessToken: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
