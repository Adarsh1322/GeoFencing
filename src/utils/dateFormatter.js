export function formatDateTime(isoString) {
  if (!isoString) {
    return '--';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(isoString) {
  if (!isoString) {
    return '--';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(isoString) {
  if (!isoString) {
    return '--';
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
