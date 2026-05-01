import React from 'react';
import ResourceRequestForm from '../components/ResourceRequestForm';

export default function ResourceRequestsPage() {
  return (
    <div className="animate-fade-in">
      <div className="section-header">
        <div>
          <h1 className="section-title">Resource Requests</h1>
          <p className="section-subtitle">
            Request additional CPU, RAM, storage, projects, or databases from your administrator
          </p>
        </div>
      </div>

      <ResourceRequestForm />
    </div>
  );
}
