import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import 'primeicons/primeicons.css';
import './styles/base.css';
import App from './App.vue';
import { router } from './router';
import { registerComponents } from './components/register';
import { es } from './utils/primevue-es';

const Institutional = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{sky.50}', 100: '{sky.100}', 200: '{sky.200}', 300: '{sky.300}', 400: '{sky.400}', 500: '{sky.600}',
      600: '{sky.700}', 700: '{sky.800}', 800: '{sky.900}', 900: '{sky.950}', 950: '{sky.950}',
    },
  },
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(PrimeVue, { theme: { preset: Institutional, options: { darkModeSelector: '.app-dark', cssLayer: false } }, locale: es, ripple: false });
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);
registerComponents(app);
app.mount('#app');
