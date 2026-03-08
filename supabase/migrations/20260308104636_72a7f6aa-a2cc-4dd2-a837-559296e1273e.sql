
CREATE TABLE public.voice_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_name TEXT NOT NULL,
  created_by UUID NOT NULL,
  active_users UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read voice rooms"
  ON public.voice_rooms FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create voice rooms"
  ON public.voice_rooms FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update voice rooms"
  ON public.voice_rooms FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete voice rooms"
  ON public.voice_rooms FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms;
