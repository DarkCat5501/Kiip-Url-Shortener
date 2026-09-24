import { useState, useEffect, useCallback } from 'react';
import { CreateLink } from './components/CreateLink';
import { LinkList } from './components/LinkList';
import { LinkStats } from './components/LinkStats';
import { getLinks, type Link } from './lib/api';

function App() {
  const [links, setLinks] = useState<Link[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Parse hash to get slug from /stats/{slug}
  const getSlugFromHash = useCallback(() => {
    const hash = window.location.hash.slice(1); // remove #
    const match = hash.match(/^\/stats\/(.+)$/);
    return match ? match[1] : null;
  }, []);

  useEffect(() => {
    setCurrentSlug(getSlugFromHash());

    const handleHashChange = () => {
      setCurrentSlug(getSlugFromHash());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [getSlugFromHash]);

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const data = await getLinks();
      setLinks(data);
    } catch (err) {
      console.error('Failed to load links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreated = (link: Link) => {
    setLinks((prev) => [link, ...prev]);
  };

  const handleDeactivated = (slug: string) => {
    setLinks((prev) =>
      prev.map((l) => (l.slug === slug ? { ...l, active: false } : l))
    );
  };

  const navigateToStats = (slug: string) => {
    window.location.hash = `#/stats/${slug}`;
  };

  if (currentSlug) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
        <LinkStats slug={currentSlug} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <h1>KIIP - Encurtador de Links</h1>
      <CreateLink onCreated={handleCreated} />
      {loading ? <p>Carregando links...</p> : <LinkList links={links} onSelect={navigateToStats} onDeactivated={handleDeactivated} />}
    </div>
  );
}

export default App;