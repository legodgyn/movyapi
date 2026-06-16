export type ApiRecord = Record<string, unknown>;

export type InfobipApi = ApiRecord & {
  id: string;
  name?: string;
  label?: string;
  api_type?: string;
  sender_number?: string;
  senderNumber?: string;
  base_url?: string;
  token?: string;
};

export type SavedTemplate = ApiRecord & {
  id: string;
  name: string;
  folder?: string;
  media_type?: string;
  body_text?: string;
  footer_text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string }>;
  body_examples?: string[];
  variable_count?: number;
  language?: string;
  category?: string;
  meta_status?: string;
  waba_id?: string;
};

export type ContactTag = ApiRecord & {
  id: string;
  name?: string;
  contacts_count?: number;
  count?: number;
};

export type ContactItem = ApiRecord & {
  id?: string;
  name?: string;
  nome?: string;
  phone?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  created_at?: string;
};

export type MediaItem = ApiRecord & {
  id: string;
  name?: string;
  file_name?: string;
  type?: string;
  url?: string;
  public_url?: string;
  size?: number;
  created_at?: string;
};

export type Campaign = ApiRecord & {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  channel?: string;
  description?: string;
  progress?: number;
  sent_count?: number;
  failed_count?: number;
  batches_count?: number;
  transmissions_count?: number;
  created_at?: string;
  created_by?: string;
  creator?: string;
};

export type User = ApiRecord & {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  is_approved?: boolean;
  approved?: boolean;
  beta_access?: boolean;
  senders_access?: boolean;
};

export type SavedFlow = ApiRecord & {
  id: string;
  name?: string;
  description?: string;
  folder?: string;
  status?: string;
  nodes?: unknown[];
  edges?: unknown[];
};
