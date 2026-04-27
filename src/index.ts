import type { Core } from '@strapi/strapi';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const paradas = await strapi.documents('api::parada.parada').findMany({
      filters: { nombre: { $null: true } },
      fields: ['documentId', 'ordenVisita'],
    });

    for (const parada of paradas) {
      await strapi.documents('api::parada.parada').update({
        documentId: parada.documentId,
        data: { nombre: String(parada.ordenVisita) },
      });
    }
  },
};
