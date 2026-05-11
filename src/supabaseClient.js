window.AGE_GAME_SUPABASE = (() => {
  const config = window.AGE_GAME_DATA?.GAME_CONFIG?.supabase ?? {};
  const table = config.objectsTable || "objects";
  const bucket = config.storageBucket || "object-images";
  const configured = Boolean(config.enabled && config.url && config.anonKey);
  const available = Boolean(window.supabase?.createClient);
  const client = configured && available ? window.supabase.createClient(config.url, config.anonKey) : null;

  function isReady() {
    return Boolean(client);
  }

  function getDisabledReason() {
    if (!configured) return "Supabase is not configured yet.";
    if (!available) return "Supabase library did not load.";
    return "";
  }

  async function getSession() {
    if (!client) return { user: null, session: null };
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return {
      user: data.session?.user ?? null,
      session: data.session ?? null,
    };
  }

  async function signIn(email) {
    if (!client) throw new Error(getDisabledReason());
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href,
      },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function isAdmin() {
    if (!client) return false;
    const { data, error } = await client.rpc("is_age_game_admin");
    if (error) return false;
    return Boolean(data);
  }

  async function fetchObjects() {
    if (!client) return [];
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromDatabaseObject);
  }

  async function uploadImage(file, userId) {
    if (!client) throw new Error(getDisabledReason());
    if (!file) return { imageUrl: "", imagePath: "" };

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const imagePath = `${userId}/${safeName}`;
    const { error } = await client.storage.from(bucket).upload(imagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;

    const { data } = client.storage.from(bucket).getPublicUrl(imagePath);
    return {
      imageUrl: data.publicUrl,
      imagePath,
    };
  }

  async function insertObject(payload) {
    if (!client) throw new Error(getDisabledReason());
    const { data, error } = await client
      .from(table)
      .insert(toDatabaseObject(payload))
      .select("*")
      .single();
    if (error) throw error;
    return fromDatabaseObject(data);
  }

  async function updateStatus(id, status) {
    if (!client) throw new Error(getDisabledReason());
    const { user } = await getSession();
    const update = {
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: status === "approved" ? user?.id ?? null : null,
    };
    const { data, error } = await client.from(table).update(update).eq("id", id).select("*").single();
    if (error) throw error;
    return fromDatabaseObject(data);
  }

  function fromDatabaseObject(row) {
    return {
      id: row.id,
      title: row.title,
      brand: row.brand,
      category: row.category,
      yearStart: row.year_start,
      yearEnd: row.year_end,
      sourceType: row.source_type,
      imageUrl: row.image_url,
      imagePath: row.image_path,
      imageType: row.image_type,
      difficulty: row.difficulty,
      tags: row.tags ?? [],
      revealText: row.reveal_text || "",
      hints: row.hints ?? [],
      submittedBy: row.submitted_by,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  function toDatabaseObject(item) {
    return {
      title: item.title,
      brand: item.brand,
      category: item.category,
      year_start: item.yearStart,
      year_end: item.yearEnd,
      source_type: item.sourceType,
      image_url: item.imageUrl || null,
      image_path: item.imagePath || null,
      image_type: item.imageType || "uploaded",
      difficulty: item.difficulty || "community",
      tags: item.tags ?? [],
      reveal_text: item.revealText || null,
      hints: item.hints ?? [],
      submitted_by: item.submittedBy,
      status: item.status || "pending",
      approved_by: item.approvedBy || null,
      approved_at: item.approvedAt || null,
    };
  }

  return {
    isReady,
    getDisabledReason,
    getSession,
    signIn,
    signOut,
    isAdmin,
    fetchObjects,
    uploadImage,
    insertObject,
    updateStatus,
  };
})();
