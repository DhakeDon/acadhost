import React from 'react';
import Dashboard from '../components/Dashboard';

// HomePage simply renders the Dashboard component.
// Dashboard handles its own data fetching (profile + projects).
export default function HomePage() {
  return <Dashboard />;
}
