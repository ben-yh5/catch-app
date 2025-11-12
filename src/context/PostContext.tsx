import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

interface PostContextType {
  shouldRefresh: boolean;
  triggerRefresh: () => void;
}

const PostContext = createContext<PostContextType | undefined>(undefined);

export const PostProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [shouldRefresh, setShouldRefresh] = useState(false);

  const triggerRefresh = useCallback(() => {
    setShouldRefresh(true);
  }, []);

  // Auto-clear the refresh flag after a short delay to allow all screens to process it
  useEffect(() => {
    if (shouldRefresh) {
      const timeout = setTimeout(() => {
        setShouldRefresh(false);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [shouldRefresh]);

  return (
    <PostContext.Provider value={{ shouldRefresh, triggerRefresh }}>
      {children}
    </PostContext.Provider>
  );
};

export const usePost = () => {
  const context = useContext(PostContext);
  if (context === undefined) {
    throw new Error('usePost must be used within a PostProvider');
  }
  return context;
};
