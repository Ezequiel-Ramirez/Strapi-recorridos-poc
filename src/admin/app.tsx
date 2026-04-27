import type { StrapiApp } from '@strapi/strapi/admin';
import { AsignarAgenteButton } from './extensions';

export default {
  config: {
    locales: ['es'],
  },
  bootstrap(app: StrapiApp) {
    app.getPlugin('content-manager').injectComponent('listView', 'actions', {
      name: 'asignar-agente',
      Component: AsignarAgenteButton,
    });
  },
};
