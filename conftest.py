"""pytest configuration – adds the project root to sys.path so that
``from api.app import ...`` works when tests are run from any directory."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
