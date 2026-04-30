import { factories } from '@strapi/strapi';

const DOCUMENT_ID_REGEX = /^[a-z0-9]+$/i;

export default factories.createCoreController('api::recorrido.recorrido', ({ strapi }) => ({
  async hojaDeRutaPorAgente(ctx) {
    const { agenteDocumentId } = ctx.params;

    if (!agenteDocumentId || !DOCUMENT_ID_REGEX.test(agenteDocumentId)) {
      return ctx.badRequest('agenteDocumentId inválido');
    }

    try {
      const data = await strapi
        .service('api::recorrido.recorrido')
        .resolverHojaDeRutaPorAgente(agenteDocumentId);
      return { data };
    } catch (err: any) {
      if (err?.status === 404) {
        return ctx.notFound(err.message);
      }
      throw err;
    }
  },

  async hojaDeRutaPorAgentes(ctx) {
    const body = ctx.request.body ?? {};
    const { agentes } = body;

    if (!Array.isArray(agentes)) {
      return ctx.badRequest('agentes debe ser un array de documentIds');
    }
    if (agentes.length === 0) {
      return ctx.badRequest('agentes no puede ser vacío');
    }

    try {
      const result = await strapi
        .service('api::recorrido.recorrido')
        .resolverHojaDeRutaPorAgentes(agentes);
      return { data: result };
    } catch (err: any) {
      if (err?.status === 400) return ctx.badRequest(err.message);
      if (err?.status === 404) return ctx.notFound(err.message);
      throw err;
    }
  },
}));
