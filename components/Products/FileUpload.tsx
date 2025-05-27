
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FaUpload } from 'react-icons/fa';
import Button from '../Common/Button';

interface FileUploadProps {
  onFileUpload: (file: File) => Promise<void>;
  isLoading: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, isLoading }) => {
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setFileName(file.name);
      // No need to call onFileUpload here if we use a separate button
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'] },
    multiple: false,
  });

  const handleUploadClick = async () => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      await onFileUpload(acceptedFiles[0]);
      setFileName(null); // Reset filename after upload
    }
  };

  return (
    <div className="p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">Produktdaten hochladen (JSON)</h3>
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-md cursor-pointer transition-colors
                    ${isDragActive ? 'border-sky-500 bg-slate-700' : 'border-slate-600 hover:border-slate-500'}`}
      >
        <input {...getInputProps()} />
        <FaUpload className={`w-12 h-12 mb-3 ${isDragActive ? 'text-sky-400' : 'text-gray-500'}`} />
        {isDragActive ? (
          <p className="text-sky-400">Datei hier ablegen...</p>
        ) : (
          <p className="text-gray-400">JSON-Datei hierher ziehen oder klicken, um auszuwählen</p>
        )}
      </div>
      {fileName && (
        <div className="mt-4 text-sm text-gray-300">
          Ausgewählte Datei: <span className="font-semibold text-sky-400">{fileName}</span>
        </div>
      )}
      {acceptedFiles && acceptedFiles.length > 0 && (
         <Button 
            onClick={handleUploadClick} 
            isLoading={isLoading} 
            disabled={isLoading}
            className="mt-4 w-full sm:w-auto"
          >
           {isLoading ? 'Wird hochgeladen...' : 'Ausgewählte Datei hochladen'}
         </Button>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Akzeptiertes Format: JSON-Datei mit Schlüsseln wie "ASIN_..." und String-Werten, die JSON-Objekte der Produkte enthalten.
      </p>
    </div>
  );
};

export default FileUpload;
