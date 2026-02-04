import React, { useState } from 'react';
import { Box, Typography, Button, Flex } from '@strapi/design-system';
import { useAnalytics } from '../hooks/useAnalytics';

export function EmployeeSearch({ value, onChange, onEmployeeFound }) {
  const { fetchEmployees } = useAnalytics();
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [foundEmployee, setFoundEmployee] = useState(null);

  const handleSearch = async () => {
    const q = searchInput?.trim();
    if (!q) {
      onChange(null);
      setFoundEmployee(null);
      setNotFound(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setFoundEmployee(null);
    try {
      const employees = await fetchEmployees({ search: q });
      if (employees?.length > 0) {
        const emp = employees[0];
        setFoundEmployee(emp);
        onChange(emp.id);
        onEmployeeFound?.(emp);
        setNotFound(false);
      } else {
        setFoundEmployee(null);
        onChange(null);
        onEmployeeFound?.(null);
        setNotFound(true);
      }
    } catch {
      setFoundEmployee(null);
      onChange(null);
      onEmployeeFound?.(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSearchInput('');
    setFoundEmployee(null);
    setNotFound(false);
    onChange(null);
    onEmployeeFound?.(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <Box style={{ minWidth: 260 }}>
      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
        Search Employee (ID or Email)
      </Typography>
      <Flex gap={2} alignItems="stretch">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter ID or email"
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #dcdce4',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        />
        <Button onClick={handleSearch} loading={loading} size="S">
          Search
        </Button>
        {(value || foundEmployee) && (
          <Button onClick={handleClear} variant="tertiary" size="S">
            Clear
          </Button>
        )}
      </Flex>
      {notFound && (
        <Typography variant="pi" textColor="danger600" style={{ marginTop: 4 }}>
          Employee not found
        </Typography>
      )}
    </Box>
  );
}
