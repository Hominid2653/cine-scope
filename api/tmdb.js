export default async function handler(req, res) {
  const { path, ...params } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing TMDB path' });
  }

  const tmdbUrl = new URL(`https://api.themoviedb.org/3/${path}`);

  tmdbUrl.searchParams.set('api_key', process.env.TMDB_KEY);

  Object.entries(params).forEach(([key, value]) => {
    tmdbUrl.searchParams.set(key, value);
  });

  try {
    const response = await fetch(tmdbUrl);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch TMDB' });
  }
}