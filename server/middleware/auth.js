const jwt = require('jsonwebtoken');
const User = require('../models/user');
const DatosConfiguracion = require('../models/datosConfiguracion');

const DEFAULT_MINUTOS_INACTIVIDAD = 30;

/**
 * Verifica el token JWT, comprueba inactividad y actualiza lastActivityAt.
 * Usar en todas las rutas que requieran autenticación para que:
 * - Cualquier petición autenticada refresque la actividad.
 * - Si la sesión superó el tiempo de inactividad, responde 401.
 */
async function verifyToken(req, res, next) {
    try {
        if (!req.headers.authorization) {
            return res.status(401).send('Unauthorized Request');
        }
        const token = req.headers.authorization.split(' ')[1];
        if (token === 'null' || !token) {
            return res.status(401).send('Unauthorized Request');
        }

        const payload = await jwt.verify(token, 'secretkey');
        if (!payload) {
            return res.status(401).send('Unauthorized Request');
        }
        req.userId = payload._id;

        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const config = await DatosConfiguracion.findOne().sort({ _id: -1 });
        const minutosInactividad = (config && config.minutosInactividad != null)
            ? config.minutosInactividad
            : DEFAULT_MINUTOS_INACTIVIDAD;
        const limiteMs = minutosInactividad * 60 * 1000;

        const now = Date.now();
        const lastActivity = user.lastActivityAt ? new Date(user.lastActivityAt).getTime() : null;
        if (lastActivity != null && (now - lastActivity > limiteMs)) {
            return res.status(401).json({ error: 'Sesión expirada por inactividad' });
        }

        await User.findByIdAndUpdate(req.userId, { lastActivityAt: new Date() });
        next();
    } catch (err) {
        return res.status(401).send('Unauthorized Request');
    }
}

module.exports = { verifyToken };
