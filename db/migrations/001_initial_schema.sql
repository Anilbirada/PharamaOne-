CREATE TABLE pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  email text NOT NULL CHECK (email = lower(trim(email))),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'pharmacist', 'cashier', 'inventory_staff', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, email)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, user_id) REFERENCES users(pharmacy_id, id) ON DELETE CASCADE,
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX sessions_user_expiry_idx ON sessions (pharmacy_id, user_id, expires_at);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX customers_name_idx ON customers (pharmacy_id, lower(name));

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  email text,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  minimum_order_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_order_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX suppliers_name_idx ON suppliers (pharmacy_id, lower(name));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  generic_name text,
  brand text,
  category text,
  sku text,
  barcode text,
  selling_price numeric(14,2) NOT NULL CHECK (selling_price >= 0),
  standard_unit_cost numeric(14,2) CHECK (standard_unit_cost >= 0),
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  target_stock integer NOT NULL DEFAULT 0 CHECK (target_stock >= 0),
  pack_size integer NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, sku),
  UNIQUE (pharmacy_id, barcode)
);
CREATE INDEX products_name_idx ON products (pharmacy_id, lower(name));
CREATE INDEX products_category_idx ON products (pharmacy_id, category);

CREATE TABLE supplier_products (
  pharmacy_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_sku text,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  pack_size integer NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  last_unit_cost numeric(14,2) CHECK (last_unit_cost >= 0),
  PRIMARY KEY (pharmacy_id, supplier_id, product_id),
  FOREIGN KEY (pharmacy_id, supplier_id) REFERENCES suppliers(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, product_id) REFERENCES products(pharmacy_id, id)
);
CREATE INDEX supplier_products_product_idx ON supplier_products (pharmacy_id, product_id);

CREATE TABLE medicine_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  product_id uuid NOT NULL,
  batch_number text NOT NULL CHECK (length(trim(batch_number)) > 0),
  expires_on date,
  unit_cost numeric(14,2) CHECK (unit_cost >= 0),
  quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_quarantined integer NOT NULL DEFAULT 0 CHECK (
    quantity_quarantined >= 0 AND quantity_quarantined <= quantity_on_hand
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, product_id) REFERENCES products(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, product_id, batch_number)
);
CREATE INDEX medicine_batches_expiry_idx ON medicine_batches (pharmacy_id, expires_on);
CREATE INDEX medicine_batches_product_idx ON medicine_batches (pharmacy_id, product_id);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  supplier_id uuid NOT NULL,
  order_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  ordered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, supplier_id) REFERENCES suppliers(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, order_number)
);
CREATE INDEX purchases_status_idx ON purchases (pharmacy_id, status, created_at);

CREATE TABLE purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (
    quantity_received >= 0 AND quantity_received <= quantity_ordered
  ),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (pharmacy_id, purchase_id) REFERENCES purchases(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, product_id) REFERENCES products(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX purchase_items_order_idx ON purchase_items (pharmacy_id, purchase_id);

CREATE TABLE purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  return_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'completed', 'cancelled')),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, purchase_id) REFERENCES purchases(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, supplier_id) REFERENCES suppliers(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, return_number)
);
CREATE INDEX purchase_returns_order_idx ON purchase_returns (pharmacy_id, purchase_id, occurred_at);

CREATE TABLE purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  purchase_return_id uuid NOT NULL,
  purchase_item_id uuid NOT NULL,
  batch_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (pharmacy_id, purchase_return_id) REFERENCES purchase_returns(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, purchase_item_id) REFERENCES purchase_items(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, batch_id) REFERENCES medicine_batches(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX purchase_return_items_return_idx ON purchase_return_items (pharmacy_id, purchase_return_id);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  customer_id uuid,
  invoice_number text NOT NULL,
  idempotency_key text,
  status text NOT NULL CHECK (status IN ('completed', 'cancelled', 'void')),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= subtotal),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  created_by uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, customer_id) REFERENCES customers(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, created_by) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, invoice_number),
  UNIQUE (pharmacy_id, idempotency_key)
);
CREATE INDEX sales_date_idx ON sales (pharmacy_id, occurred_at);
CREATE INDEX sales_customer_idx ON sales (pharmacy_id, customer_id, occurred_at);

CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  quantity_returned integer NOT NULL DEFAULT 0 CHECK (
    quantity_returned >= 0 AND quantity_returned <= quantity
  ),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost numeric(14,2) CHECK (unit_cost >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  FOREIGN KEY (pharmacy_id, sale_id) REFERENCES sales(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, product_id) REFERENCES products(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, batch_id) REFERENCES medicine_batches(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX sale_items_sale_idx ON sale_items (pharmacy_id, sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (pharmacy_id, product_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'credit', 'other')),
  reference text,
  received_by uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, sale_id) REFERENCES sales(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, received_by) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX payments_sale_idx ON payments (pharmacy_id, sale_id, occurred_at);

CREATE TABLE returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  return_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'rejected', 'cancelled')),
  refund_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (refund_total >= 0),
  reason text,
  processed_by uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, sale_id) REFERENCES sales(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, processed_by) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, return_number)
);
CREATE INDEX returns_sale_idx ON returns (pharmacy_id, sale_id, occurred_at);

CREATE TABLE return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  return_id uuid NOT NULL,
  sale_item_id uuid NOT NULL,
  batch_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  refund_amount numeric(14,2) NOT NULL CHECK (refund_amount >= 0),
  restocked boolean NOT NULL DEFAULT false,
  FOREIGN KEY (pharmacy_id, return_id) REFERENCES returns(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, sale_item_id) REFERENCES sale_items(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, batch_id) REFERENCES medicine_batches(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX return_items_return_idx ON return_items (pharmacy_id, return_id);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  product_id uuid NOT NULL,
  batch_id uuid,
  movement_type text NOT NULL CHECK (
    movement_type IN ('opening', 'purchase_receipt', 'sale', 'sale_return', 'supplier_return', 'adjustment', 'quarantine')
  ),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, product_id) REFERENCES products(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, batch_id) REFERENCES medicine_batches(pharmacy_id, id),
  FOREIGN KEY (pharmacy_id, actor_id) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id),
  UNIQUE (pharmacy_id, idempotency_key)
);
CREATE INDEX stock_movements_product_date_idx ON stock_movements (pharmacy_id, product_id, occurred_at);
CREATE INDEX stock_movements_batch_idx ON stock_movements (pharmacy_id, batch_id, occurred_at);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  occurred_on date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, created_by) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX expenses_date_idx ON expenses (pharmacy_id, occurred_on);

CREATE TABLE pharmacy_settings (
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, setting_key)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pharmacy_id, actor_id) REFERENCES users(pharmacy_id, id),
  UNIQUE (pharmacy_id, id)
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (pharmacy_id, entity_type, entity_id, occurred_at);
CREATE INDEX audit_logs_actor_idx ON audit_logs (pharmacy_id, actor_id, occurred_at);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pharmacies', 'users', 'sessions', 'customers', 'suppliers', 'supplier_products', 'products',
    'medicine_batches', 'purchases', 'purchase_items', 'purchase_returns',
    'purchase_return_items', 'sales', 'sale_items',
    'payments', 'returns', 'return_items', 'stock_movements', 'expenses',
    'pharmacy_settings', 'audit_logs'
  ]   LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF table_name = 'pharmacies' THEN
      EXECUTE format(
        'CREATE POLICY pharmacy_isolation ON %I USING (id = nullif(current_setting(''app.pharmacy_id'', true), '''')::uuid) WITH CHECK (id = nullif(current_setting(''app.pharmacy_id'', true), '''')::uuid)',
        table_name
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY pharmacy_isolation ON %I USING (pharmacy_id = nullif(current_setting(''app.pharmacy_id'', true), '''')::uuid) WITH CHECK (pharmacy_id = nullif(current_setting(''app.pharmacy_id'', true), '''')::uuid)',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are immutable';
END
$$;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmaone_app') THEN
    CREATE ROLE pharmaone_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'pharmaone_app'
      AND (
        rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
        OR EXISTS (
          SELECT 1 FROM pg_auth_members
          WHERE member = pg_roles.oid
        )
      )
  ) THEN
    RAISE EXCEPTION 'pharmaone_app must not be a superuser, a member of another role, or have database, role, replication, or RLS-bypass privileges';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pharmaone_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  pharmacies, users, sessions, customers, suppliers, supplier_products,
  products, medicine_batches, purchases, purchase_items, purchase_returns,
  purchase_return_items, sales, sale_items, payments, returns, return_items,
  stock_movements, expenses, pharmacy_settings, audit_logs
TO pharmaone_app;
