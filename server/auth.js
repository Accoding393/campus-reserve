import jwt from 'jsonwebtoken';
import { query } from './db.js';

const secret = process.env.JWT_SECRET || 'development-only-change-me';

export function createToken(user) {
  return jwt.sign({
    id: user.id,
    role: user.role,
    collegeId: user.college_id,
    department: user.department || null,
    isClubHead: Boolean(user.is_club_head)
  }, secret, { expiresIn: '8h' });
}

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Sign in is required.' });
  try {
    const payload = jwt.verify(token, secret);
    const result = await query(
      `SELECT id, role, college_id AS "collegeId", department, is_club_head AS "isClubHead"
       FROM users WHERE id=$1`,
      [payload.id]
    );
    if (!result.rowCount) return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ message: 'You do not have permission to perform this action.' });
}
