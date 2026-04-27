export default {
  beforeCreate(event) {
    const { data } = event.params;
    if (data.ordenVisita !== undefined) {
      data.nombre = String(data.ordenVisita);
    }
  },

  beforeUpdate(event) {
    const { data } = event.params;
    if (data.ordenVisita !== undefined) {
      data.nombre = String(data.ordenVisita);
    }
  },
};
