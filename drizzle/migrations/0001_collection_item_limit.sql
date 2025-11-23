-- Enforce the 5-item per collection limit at the database level
CREATE OR REPLACE FUNCTION enforce_collection_item_limit()
RETURNS trigger AS $$
BEGIN
  -- Lock existing items in the collection to serialize concurrent inserts
  PERFORM 1 FROM collection_items WHERE collection_id = NEW.collection_id FOR UPDATE;

  IF (SELECT COUNT(*) FROM collection_items WHERE collection_id = NEW.collection_id) >= 5 THEN
    RAISE EXCEPTION 'Collection is full' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_items_limit_trg
BEFORE INSERT ON collection_items
FOR EACH ROW
EXECUTE FUNCTION enforce_collection_item_limit();
