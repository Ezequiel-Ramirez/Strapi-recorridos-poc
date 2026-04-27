export default {
  routes: [
    {
      method: 'GET',
      path: '/recorridos/hoja-de-ruta-por-agente/:agenteDocumentId',
      handler: 'recorrido.hojaDeRutaPorAgente',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
