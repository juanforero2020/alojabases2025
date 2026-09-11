const { Router } = require('express');
const router = Router();
const User = require('../models/user');
const jwt = require('jsonwebtoken');
const { verifyToken } = require('../middleware/auth');

router.get('/', (req, res) => res.send('Holly Molly'))


router.post('/register', async (req, res) => {
	if(req.body.password){}
    const { email, password, name, lastname, status, codigoFacturacion } = req.body;
    const newUser = new User({ email, password, name, lastname , status, codigoFacturacion});
    await newUser.save();
    res.send("Registrado");
});


router.post('/signInGoogle', async (req, res) => {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(401).send('Correo no existe');
    await User.findByIdAndUpdate(user._id, { lastActivityAt: new Date() });
    const token = jwt.sign({ _id: user._id }, 'secretkey');

    return res.status(200).json({ token });
});


router.get('/dashboard', verifyToken, (req, res) => {//para rutas privadas
    
           
});

/**
 * Comprueba sesión (heartbeat / al volver a la app en móvil).
 * verifyToken ya valida token, inactividad y actualiza lastActivityAt; aquí solo respondemos 200.
 */
router.get('/session-check', verifyToken, (req, res) => {
    res.status(200).json({ ok: true });
});

router.get('/getUsers', verifyToken, async (req, res) => {
    const grupos = await User.find();
    res.send(grupos);
});

router.get('/getUsers2', verifyToken, async (req, res) => {
    const grupos = await User.find({"empresa":"Webbi"});
    res.send(grupos);
});

router.get('/getUsers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const grupos = await User.findById(id);
    res.json(grupos);
});

router.get('/getUsers1/:correo', verifyToken, async (req, res) => {
    const { correo } = req.params;
    const grupos = await User.find({"email": correo});
    res.json(grupos);
});



router.post('/newUser', verifyToken, async (req, res) => {
    const { email, password, name, rol,grupo,sucursal,numUsuarios,username, status,codigoFacturacion, codigoAccesoPago } = req.body;
    const emailExiste = await User.findOne({ email });
    if (emailExiste){
        return  res.status(401).send('Correo ya está asociado a otra cuenta');
    } 
    else{
        const { email, password, name, rol,sucursal,numUsuarios,username,imageProfile, status, codigoFacturacion, codigoAccesoPago } = req.body;
        const newUser = new User({ email, password, name, rol,sucursal,numUsuarios,username,imageProfile, status, codigoFacturacion, codigoAccesoPago});
        await newUser.save();
        res.json({status: 'user creado'});
    }

});

router.post('/signIn', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).send('La cuenta no existe');
    if (user.password !== password) return res.status(401).send('Contraseña Incorrecta');
    if (user.status !== "Activo") return res.status(404).send('Usuario bloqueado');
    await User.findByIdAndUpdate(user._id, { lastActivityAt: new Date() });
    const token = jwt.sign({ _id: user._id }, 'secretkey');
    return res.status(200).json({ token });
});


router.put('/updateUser/:id', verifyToken, async (req, res, next) => {
    const { id } = req.params;
    const user = {
        name: req.body.name,
        password: req.body.password,
        email: req.body.email,
        username: req.body.username,
        grupo: req.body.grupo,
        empresa: req.body.empresa,
        status:req.body.status,
        imageProfile: req.body.imageProfile,
        codigoFacturacion: req.body.codigoFacturacion,
        codigoAccesoPago: req.body.codigoAccesoPago
    };
    await User.findByIdAndUpdate(id, {$set: user}, {new: true});
    res.json({status: 'Perfil Actualizado'});  
})


router.put('/update/:id', verifyToken, async (req, res, next) => {
    const { id } = req.params;
    const usuario = {
        name: req.body.name,
        password: req.body.password,
        email: req.body.email,
        username: req.body.username,
        grupo: req.body.grupo,
        empresa: req.body.empresa,
        status:req.body.status,
        codigoFacturacion: req.body.codigoFacturacion,
        codigoAccesoPago: req.body.codigoAccesoPago
    };
    await User.findByIdAndUpdate(id, {$set: usuario}, {new: true});
    res.json({status: 'User Updated'});  
})


router.delete('/delete/:id', verifyToken, async (req, res, next) => {
    await User.findByIdAndRemove(req.params.id);
    res.json({status: 'USER Deleted'});
})




module.exports = router;