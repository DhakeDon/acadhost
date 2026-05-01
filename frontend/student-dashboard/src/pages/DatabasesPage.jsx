import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import DatabaseSection from '../components/DatabaseSection';

export default function DatabasesPage() {
  const [databases, setDatabases] = useState([]);
  const [quota,     setQuota]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const loadDatabases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res   = await api.get('/databases');
      const data  = res.data.data;
      setDatabases(data.items || []);
      setQuota(data.quota || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load databases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDatabases(); }, [loadDatabases]);

  return (
    <div className="animate-fade-in">
      <div className="section-header">
        <div>
          <h1 className="section-title">Databases</h1>
          <p className="section-subtitle">
            Isolated MySQL schemas, each with restricted credentials
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={loadDatabases}>
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
          <button className="btn btn-ghost btn-sm" onClick={loadDatabases} style={{ marginLeft: '1rem' }}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="spinner-center"><div className="spinner spinner-lg" /></div>
      ) : (
        <DatabaseSection
          databases={databases}
          quota={quota}
          onRefresh={loadDatabases}
        />
      )}
    </div>
  );
}
