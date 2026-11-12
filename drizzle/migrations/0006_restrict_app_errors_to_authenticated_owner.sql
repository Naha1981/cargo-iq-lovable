DROP POLICY IF EXISTS app_errors_insert_authenticated ON public.app_errors;
CREATE POLICY app_errors_insert_authenticated
  ON public.app_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);