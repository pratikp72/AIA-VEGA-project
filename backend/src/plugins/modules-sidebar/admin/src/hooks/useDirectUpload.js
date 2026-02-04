/**
 * Custom hook to inject direct upload functionality into media fields
 */

import { useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';

export const useDirectUpload = (fieldName, onChange, attribute) => {
  const fetchClient = useFetchClient();

  const uploadFile = async (file) => {
    try {
      const formData = new FormData();
      formData.append('files', file);
      
      if (file.name) {
        formData.append('fileInfo', JSON.stringify({
          alternativeText: file.name,
          caption: file.name,
        }));
      }

      const { data } = await fetchClient.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const uploadedFile = Array.isArray(data) ? data[0] : data;
      
      if (uploadedFile?.id) {
        if (attribute?.multiple) {
          // Handle multiple files
          const currentValue = Array.isArray(onChange) ? onChange : [];
          onChange([...currentValue, uploadedFile.id]);
        } else {
          // Handle single file
          onChange(uploadedFile.id);
        }
        return uploadedFile;
      }
      
      throw new Error('Upload failed - no file ID returned');
    } catch (error) {
      console.error('Direct upload error:', error);
      throw error;
    }
  };

  return { uploadFile };
};
