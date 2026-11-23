// Връзка с фискално устройство и банков терминал.
// Засега е само драйвер "none": продажбата се записва, но бон не се печата.
// Драйверът за Елтрейд ще се добави тук със същия интерфейс.

const drivers = {
  none: {
    name: 'Без фискално устройство',
    async printReceipt(order) {
      return { ok: true, ref: `NOFISC-${order.number}` };
    },
  },
};

const terminals = {
  none: {
    name: 'Без банков терминал',
    async charge(amount) {
      return { ok: true, ref: null, amount };
    },
  },
};

export function fiscalDriver(name) {
  return drivers[name] || drivers.none;
}

export function cardTerminal(name) {
  return terminals[name] || terminals.none;
}
