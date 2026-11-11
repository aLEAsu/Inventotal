import type { App } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Textarea from 'primevue/textarea';
import Select from 'primevue/select';
import MultiSelect from 'primevue/multiselect';
import DatePicker from 'primevue/datepicker';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Checkbox from 'primevue/checkbox';
import ToggleSwitch from 'primevue/toggleswitch';
import SelectButton from 'primevue/selectbutton';
import Password from 'primevue/password';
import Message from 'primevue/message';
import Skeleton from 'primevue/skeleton';
import Chart from 'primevue/chart';
import ProgressSpinner from 'primevue/progressspinner';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import Menu from 'primevue/menu';

/** Registro global de componentes PrimeVue usados en toda la aplicación */
export function registerComponents(app: App) {
  const c = {
    Button, InputText, InputNumber, Textarea, Select, MultiSelect, DatePicker, DataTable, Column, Tag, Dialog, Toast, ConfirmDialog,
    Tabs, TabList, Tab, TabPanels, TabPanel, Checkbox, ToggleSwitch, SelectButton, Password, Message, Skeleton, Chart, ProgressSpinner,
    IconField, InputIcon, Menu,
  };
  for (const [name, comp] of Object.entries(c)) app.component(name, comp);
}

declare module 'vue' {
  export interface GlobalComponents {
    Button: typeof Button; InputText: typeof InputText; InputNumber: typeof InputNumber; Textarea: typeof Textarea; Select: typeof Select;
    MultiSelect: typeof MultiSelect; DatePicker: typeof DatePicker; DataTable: typeof DataTable; Column: typeof Column; Tag: typeof Tag;
    Dialog: typeof Dialog; Toast: typeof Toast; ConfirmDialog: typeof ConfirmDialog; Tabs: typeof Tabs; TabList: typeof TabList; Tab: typeof Tab;
    TabPanels: typeof TabPanels; TabPanel: typeof TabPanel; Checkbox: typeof Checkbox; ToggleSwitch: typeof ToggleSwitch; SelectButton: typeof SelectButton;
    Password: typeof Password; Message: typeof Message; Skeleton: typeof Skeleton; Chart: typeof Chart; ProgressSpinner: typeof ProgressSpinner;
    IconField: typeof IconField; InputIcon: typeof InputIcon; Menu: typeof Menu;
  }
}
