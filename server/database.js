const mongoose = require("mongoose");

//const URI ="mongodb+srv://yanderst:Estud1ante@alojabases-8gbum.mongodb.net/alojabases?retryWrites=true&w=majority"; // ---base yander
//const URI ="mongodb+srv://yander:1234asdf@cluster0.brhib.mongodb.net/AlojabasesNueva"; // nueva-------------
//const URI ="mongodb+srv://yander:AB1234cd@cluster0.vxbcw.mongodb.net/ALOJABASESAGOSTO"; // nuevaAGOSTO-------------
//const URI ="mongodb+srv://yander:YanderGrace096@alojabases.ynyl6.mongodb.net/AlojaBaseDiciembre"; // Diciembre-------------
//const URI ="mongodb+srv://yander:YanderGrace096@cluster0.axwc1.mongodb.net/alojabasesJunio"; // JUNIOOOOO-------------
//const URI ="mongodb+srv://yander:yander1996@alojabases.0jxe94s.mongodb.net/alojabasesDiciembre"; // PRODUCCION-DICIEMBRE-------------



//const URI ="mongodb+srv://yander:yander1234@cluster0.dbmpy.mongodb.net/alojabasesOctubre"; // PRUEBAS-OCTUBRE-------------


// 1. COMENTAR LA URI DE PRODUCCIÓN ACTIVA:
// const URI ="mongodb+srv://ysantana:YanderGrace096@alojabasesabril.1wfv9w1.mongodb.net/Alojabases_Abril"; // PRODUCCION-ABRIL-------------

// 2. [NUEVA LÍNEA] URI DE PRUEBAS ACTIVA:
const URI ="mongodb+srv://jeffzambrano66:PruebasAlojabases@prueba.ftkzhyv.mongodb.net/base_prueba?retryWrites=true&w=majority"; 
// ...

mongoose
  .connect(URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  // 3. MENSAJE CLARO DE CONEXIÓN A PRUEBAS:
  .then((db) => console.log("DB de PRUEBAS (base_prueba) conectada con éxito")) 
  .catch((err) => console.error(err));
