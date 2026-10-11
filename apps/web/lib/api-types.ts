export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'idempotency_conflict'
  | 'service_unavailable'
  | 'configuration_required'
  | 'method_not_allowed'
  | 'network';

export interface Workspace {
  id: string;
  name: string;
  role: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface ProjectSummary {
  received_minor: string;
  expense_minor: string;
  labor_cost_minor: string;
  cash_surplus_minor: string;
  actual_profit_minor: string;
  projected_profit_minor: string;
  total_minutes: number | string;
  profit_per_hour_minor: string | null;
  margin_percent: string | null;
}
export type ProjectStatus = 'active' | 'completed' | 'archived';
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  client_name: string;
  currency: string;
  contract_value_minor: string;
  hourly_cost_minor: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  summary: ProjectSummary;
}
export interface CurrencyTotals {
  currency: string;
  received_minor: string;
  expense_minor: string;
  labor_cost_minor: string;
  cash_surplus_minor: string;
  actual_profit_minor: string;
  projected_profit_minor: string;
  total_minutes: number | string;
  project_count: number;
}
export interface WorkspaceSummary {
  totals_by_currency: CurrencyTotals[];
  project_count: number;
}

export type EntryKind = 'time-entries' | 'expenses' | 'payments';
interface EntryBase {
  id: string;
  workspace_id: string;
  project_id: string;
  created_at: string;
}
export interface TimeEntry extends EntryBase {
  worked_on: string;
  minutes: number;
  hourly_cost_minor: string;
  note?: string | null;
}
export interface Expense extends EntryBase {
  spent_on: string;
  amount_minor: string;
  description: string;
}
export interface Payment extends EntryBase {
  received_on: string;
  amount_minor: string;
  note?: string | null;
}
export type Entry = TimeEntry | Expense | Payment;
