import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function HealthEventList({ events, onUpdate, readOnly = false }) {
  const [editingId, setEditingId] = useState(null);
  const [editNotes, setEditNotes] = useState('');

  const startEdit = (evt) => {
    setEditingId(evt.event_id);
    setEditNotes(evt.notes || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNotes('');
  };

  const saveNotes = async (eventId) => {
    const { error } = await supabase
      .from('health_events')
      .update({ notes: editNotes })
      .eq('id', eventId);

    if (error) {
      alert('Failed to update notes: ' + error.message);
      return;
    }

    setEditingId(null);
    if (onUpdate) onUpdate();
  };

  const deleteEvent = async (eventId) => {
    if (!confirm('Delete this health event?')) return;

    const { error } = await supabase
      .from('health_events')
      .delete()
      .eq('id', eventId);

    if (error) {
      alert('Failed to delete: ' + error.message);
      return;
    }

    if (onUpdate) onUpdate();
  };

  if (!events || events.length === 0) {
    return <p className="muted">No health events recorded.</p>;
  }

  return (
    <div className="health-event-list">
      {events.map((evt) => (
        <div key={evt.event_id} className="health-event-card">
          <div className="health-event-header">
            <span className="badge" style={{ background: '#d1ecf1', color: '#0c5460' }}>
              {evt.treatment_type}
            </span>
            <span className="health-event-date">
              {new Date(evt.treatment_date).toLocaleDateString()}
            </span>
          </div>

          <div className="health-event-details">
            {evt.nlis_tag && (
              <span className="health-event-tag">NLIS: {evt.nlis_tag}</span>
            )}
            {evt.management_tag && (
              <span className="health-event-tag">Mgt Tag: {evt.management_tag}</span>
            )}
            <span className="health-event-type">{evt.cattle_type}</span>
          </div>

          {editingId === evt.event_id ? (
            <div className="health-event-notes-edit">
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                rows="3"
              />
              <div className="form-actions">
                <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => saveNotes(evt.event_id)}>
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {evt.notes && <p className="health-event-notes">{evt.notes}</p>}
              {!readOnly && (
                <div className="health-event-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit(evt)}>
                    {evt.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteEvent(evt.event_id)}>
                    Delete
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
