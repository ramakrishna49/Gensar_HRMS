const jwt = require('jsonwebtoken');
require('dotenv').config();
const { query } = require('../config/database');

// Verify JWT Token and check the user is still active in the database
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            message: 'Access denied. No token provided.' 
        });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        // Ensure the account still exists and is active (blocks terminated/paused/deleted users).
        // Also re-read the current role so role changes (e.g. demotions) take effect
        // immediately instead of waiting for the JWT to expire.
        try {
            const result = await query('SELECT id, role, status FROM employees WHERE id = $1', [decoded.id]);
            if (result.rows.length === 0) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Account no longer exists.' 
                });
            }
            const current = result.rows[0];
            if (current.status !== 'active') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Your account has been deactivated. Contact your administrator.' 
                });
            }
            req.user.role = current.role;
        } catch (dbError) {
            return res.status(500).json({ success: false, message: 'Server error' });
        }

        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid or expired token.' 
        });
    }
};

// Check if user is Admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. Admin role required.' 
        });
    }
    next();
};

// Check if user is Manager or above
const isManager = (req, res, next) => {
    const allowedRoles = ['admin', 'manager', 'team_lead'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. Manager role or above required.' 
        });
    }
    next();
};

// Generate JWT Token
const generateToken = (user) => {
    return jwt.sign(
        { 
            id: user.id, 
            employee_id: user.employee_id,
            email: user.email, 
            role: user.role,
            name: `${user.first_name} ${user.last_name}`
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// Which announcement target_audience values a given role may see.
// team_lead counts as manager-level; hr/manager/team_lead are also employees.
const audienceForRole = (role) => {
    switch (role) {
        case 'admin': return ['all', 'admin'];
        case 'hr': return ['all', 'hr', 'employee'];
        case 'manager':
        case 'team_lead': return ['all', 'manager', 'employee'];
        default: return ['all', 'employee'];
    }
};

module.exports = { 
    verifyToken, 
    isAdmin, 
    isManager, 
    generateToken,
    audienceForRole
};
