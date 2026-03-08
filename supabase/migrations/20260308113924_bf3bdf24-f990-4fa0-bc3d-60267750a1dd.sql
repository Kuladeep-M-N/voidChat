-- Allow admin to insert invite codes (using service role or specific policy)
CREATE POLICY "Anyone can insert invite codes" ON public.invite_codes
FOR INSERT WITH CHECK (true);

-- Allow deleting unused invite codes
CREATE POLICY "Anyone can delete unused invite codes" ON public.invite_codes
FOR DELETE USING (is_used = false);