// Iconos de navegación: una sola familia (Phosphor, estilo lineal) con tamaño
// y grosor consistentes, como pide la skill de UI/UX. Los iconos van junto al
// texto de cada opción, así que son decorativos y se ocultan del árbol de
// accesibilidad (aria-hidden); el texto es lo que se anuncia.
import {
  Archive,
  Buildings,
  CaretDown,
  ChartBar,
  ClockCounterClockwise,
  GearSix,
  House,
  Key,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Truck,
  User,
  Users,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';

export type NavIconName =
  | 'home'
  | 'companies'
  | 'licenses'
  | 'sales'
  | 'invoices'
  | 'cash'
  | 'customers'
  | 'products'
  | 'categories'
  | 'inventory'
  | 'suppliers'
  | 'purchases'
  | 'users'
  | 'roles'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'chevron';

const ICONS: Record<NavIconName, Icon> = {
  home: House,
  companies: Buildings,
  licenses: Key,
  sales: ShoppingCart,
  invoices: Receipt,
  cash: Wallet,
  customers: Users,
  products: Package,
  categories: Tag,
  inventory: Archive,
  suppliers: Truck,
  purchases: ShoppingBag,
  users: User,
  roles: ShieldCheck,
  reports: ChartBar,
  audit: ClockCounterClockwise,
  settings: GearSix,
  chevron: CaretDown,
};

export function NavIcon({ name, size = 20 }: { name: NavIconName; size?: number }) {
  const PhosphorIcon = ICONS[name];
  return <PhosphorIcon size={size} weight="regular" aria-hidden="true" />;
}
