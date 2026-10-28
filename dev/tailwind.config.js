// Paleta da logo VetAgro: o "azul" do sistema vira verde-floresta e o "verde" vira o verde-folha.
const floresta = { 50: '#EEF6F0', 100: '#D5E8D8', 200: '#ADD6B9', 300: '#7BB98E', 400: '#46935F', 500: '#1F6E3A', 600: '#145328', 700: '#0B4521', 800: '#063B19', 900: '#052A13', 950: '#031A0B' };
const folha    = { 50: '#F3F9EC', 100: '#E3F1CF', 200: '#C7E3A1', 300: '#A3CF6B', 400: '#7DB31F', 500: '#5C920D', 600: '#3A8516', 700: '#327214', 800: '#285C12', 900: '#1E4510', 950: '#112908' };
module.exports = {
  content: ['./index.src.html'],
  theme: { extend: { colors: { blue: floresta, emerald: folha, floresta, folha } } }
};
