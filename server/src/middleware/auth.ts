import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { AuthenticatedRequest, AuthenticatedUser } from '../types/index';

const tenantId = process.env.AZURE_TENANT_ID!;

const jwksClient = jwksRsa({
  jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (!header.kid) {
    return callback(new Error('No kid in token header'));
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err || !key) return callback(err ?? new Error('Signing key not found'));
    callback(null, key.getPublicKey());
  });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  jwt.verify(
    token,
    getSigningKey,
    {
      algorithms: ['RS256'],
      // Azure management tokens have audience "https://management.azure.com/"
      audience: ['https://management.azure.com/', 'https://management.azure.com'],
      issuer: [
        `https://sts.windows.net/${tenantId}/`,
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
      ],
    },
    (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string') {
        console.error('Auth failed:', err?.message);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const payload = decoded as Record<string, unknown>;

      req.user = {
        oid: payload.oid as string,
        name: payload.name as string | undefined,
        email: (payload.preferred_username ?? payload.email) as string | undefined,
        tenantId: (payload.tid as string) ?? tenantId,
        accessToken: token,
      };

      next();
    }
  );
}
